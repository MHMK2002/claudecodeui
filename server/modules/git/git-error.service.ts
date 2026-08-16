import { AppError } from '@/shared/utils.js';

type GitIssueCode =
  | 'GIT_MISSING'
  | 'NOT_A_GIT_REPOSITORY'
  | 'NO_REMOTE'
  | 'AUTH_FAILED'
  | 'NETWORK_OFFLINE'
  | 'DETACHED_HEAD'
  | 'DIRTY_BRANCH_SWITCH'
  | 'MERGE_CONFLICT'
  | 'REBASE_CONFLICT'
  | 'PERMISSION_DENIED'
  | 'GIT_OPERATION_FAILED';

type GitRecoveryAction =
  | 'INSTALL_GIT'
  | 'INITIALIZE_REPOSITORY'
  | 'OPEN_GIT_SETTINGS'
  | 'RETRY'
  | 'REVIEW_CHANGES'
  | 'RESOLVE_CONFLICTS'
  | 'CREATE_BRANCH';

type GitFailure = {
  code: GitIssueCode;
  error: string;
  details: string;
  action: GitRecoveryAction;
  statusCode: number;
};

function readErrorText(error: unknown): string {
  const record = error as { message?: unknown; stderr?: unknown; stdout?: unknown; code?: unknown };
  return [record?.message, record?.stderr, record?.stdout]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .trim();
}

/**
 * Converts Git/subprocess failures into the stable recovery contract consumed
 * by Git routes and the Source Control UI. Classification never exposes the
 * command line; only sanitized outcome-oriented details leave the server.
 */
export function classifyGitFailure(
  error: unknown,
  context: 'status' | 'checkout' | 'fetch' | 'pull' | 'push' | 'publish' | 'continue' | 'write',
): GitFailure {
  const raw = readErrorText(error);
  const lower = raw.toLowerCase();
  const systemCode = (error as { code?: unknown })?.code;

  if (error instanceof AppError && error.code === 'NOT_A_GIT_REPOSITORY') {
    return {
      code: 'NOT_A_GIT_REPOSITORY',
      error: 'Not a Git repository',
      details: 'Initialize this project to start tracking changes.',
      action: 'INITIALIZE_REPOSITORY',
      statusCode: 400,
    };
  }
  if (systemCode === 'ENOENT' || /(?:spawn|command).*git.*enoent|git: command not found/.test(lower)) {
    return {
      code: 'GIT_MISSING',
      error: 'Git is not installed',
      details: 'Install Git, then retry source control.',
      action: 'INSTALL_GIT',
      statusCode: 503,
    };
  }
  if (/could not resolve (?:host|hostname)|network is unreachable|failed to connect|connection timed out/.test(lower)) {
    return {
      code: 'NETWORK_OFFLINE',
      error: 'Network unavailable',
      details: 'Check the network connection, then retry.',
      action: 'RETRY',
      statusCode: 503,
    };
  }
  if (/publickey|authentication failed|could not read username|repository not found|access denied/.test(lower)) {
    return {
      code: 'AUTH_FAILED',
      error: 'Remote authentication failed',
      details: 'Check the remote credentials or SSH key in Git settings.',
      action: 'OPEN_GIT_SETTINGS',
      statusCode: 401,
    };
  }
  if (/does not appear to be a git repository|no configured push destination|no such remote|no upstream/.test(lower)) {
    return {
      code: 'NO_REMOTE',
      error: 'No usable remote is configured',
      details: 'Add or repair a remote in Git settings.',
      action: 'OPEN_GIT_SETTINGS',
      statusCode: 409,
    };
  }
  if (context === 'checkout' && /local changes.*overwritten|commit your changes or stash|would be overwritten/.test(lower)) {
    return {
      code: 'DIRTY_BRANCH_SWITCH',
      error: 'Branch switch blocked by local changes',
      details: 'Commit or discard the affected changes before switching branches.',
      action: 'REVIEW_CHANGES',
      statusCode: 409,
    };
  }
  if (/rebase.*conflict|could not apply|resolve all conflicts manually/.test(lower)) {
    return {
      code: 'REBASE_CONFLICT',
      error: 'Rebase conflicts need attention',
      details: 'Resolve every conflicted file, then continue the rebase.',
      action: 'RESOLVE_CONFLICTS',
      statusCode: 409,
    };
  }
  if (/\bconflict\b|unmerged files|automatic merge failed/.test(lower)) {
    return {
      code: 'MERGE_CONFLICT',
      error: 'Merge conflicts need attention',
      details: 'Resolve every conflicted file, then continue the merge.',
      action: 'RESOLVE_CONFLICTS',
      statusCode: 409,
    };
  }
  if (systemCode === 'EACCES' || systemCode === 'EPERM' || /operation not permitted|permission denied/.test(lower)) {
    return {
      code: 'PERMISSION_DENIED',
      error: 'Git cannot write to this project',
      details: 'Restore project folder permissions, then retry.',
      action: 'RETRY',
      statusCode: 403,
    };
  }
  if (/detached head|head detached|not currently on a branch/.test(lower)) {
    return {
      code: 'DETACHED_HEAD',
      error: 'Detached HEAD',
      details: 'Create or switch to a branch before publishing changes.',
      action: 'CREATE_BRANCH',
      statusCode: 409,
    };
  }

  return {
    code: 'GIT_OPERATION_FAILED',
    error: 'Git operation failed',
    details: raw || 'Retry the operation. If it fails again, inspect Git settings.',
    action: context === 'status' ? 'RETRY' : 'REVIEW_CHANGES',
    statusCode: 500,
  };
}
