import { constants as fsConstants } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';

import spawn from 'cross-spawn';

import { githubTokensDb, projectsDb } from '@/modules/database/index.js';
import { createProject } from '@/modules/projects/services/project-management.service.js';
import type { WorkspacePathValidationResult } from '@/shared/types.js';
import { AppError, validateWorkspacePath } from '@/shared/utils.js';

type CloneProjectInput = {
  attemptId: string;
  destinationPath: string;
  repositoryUrl: string;
  githubTokenId?: number | null;
  newGithubToken?: string | null;
  userId: number | string;
  /** Internal route lease used to bind disconnect cancellation to this request. */
  requestGeneration?: symbol;
};

type CloneProgressPhase =
  | 'preparing'
  | 'cloning'
  | 'receiving'
  | 'resolving'
  | 'finalizing'
  | 'registering';

type CloneProgressPayload = {
  phase: CloneProgressPhase;
  percent: number | null;
  message: string;
};

type CloneCompletePayload = {
  project: Record<string, unknown>;
  message: string;
};

type CloneProjectEventHandlers = {
  onProgress: (payload: CloneProgressPayload) => void;
  onComplete: (payload: CloneCompletePayload) => void;
};

type GitCloneProcess = {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: 'close', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): void;
  kill(): void;
};

type CloneDestinationState =
  | 'missing'
  | 'empty'
  | 'non_empty'
  | 'not_directory'
  | 'unwritable';

type FinalizedClone = {
  rollback: () => Promise<void>;
};

type ClonePathIdentity = {
  device: number;
  inode: number;
  changeTimeMs: number;
  birthTimeMs: number;
};

type CloneStagingReservation = {
  path: string;
  identity: ClonePathIdentity;
};

type CloneProjectDependencies = {
  validatePath: (requestedPath: string) => Promise<WorkspacePathValidationResult>;
  inspectDestination: (destinationPath: string) => Promise<CloneDestinationState>;
  isProjectRegistered: (projectPath: string) => Promise<boolean>;
  reserveStagingPath: (stagingPathPrefix: string) => Promise<CloneStagingReservation>;
  readPathIdentity: (targetPath: string) => Promise<ClonePathIdentity | null>;
  removePath: (targetPath: string) => Promise<void>;
  finalizeClone: (stagingPath: string, destinationPath: string) => Promise<FinalizedClone>;
  getGithubTokenById: (
    tokenId: number,
    userId: number,
  ) => Promise<{ github_token: string } | null>;
  spawnGitClone: (
    repositoryUrl: string,
    clonePath: string,
    authorizationHeader: string | null,
  ) => GitCloneProcess;
  registerProject: (
    projectPath: string,
    customName: string,
  ) => Promise<{ project: Record<string, unknown> }>;
  logError: (message: string, error: unknown) => void;
};

export type CloneCancellationResult =
  | 'cancelled'
  | 'not_found'
  | 'forbidden'
  | 'too_late';

/**
 * Attempt handle consumed by the Projects clone route. `release` is bound to a
 * private generation, so a conflicting request cannot remove another clone.
 */
export type CloneProjectOperation = {
  attemptId: string;
  waitForCompletion: Promise<void>;
  cancel: () => CloneCancellationResult;
  release: () => void;
};

type CloneAttemptStage = 'starting' | 'cloning' | 'finalizing' | 'registering' | 'complete';

type ActiveCloneAttempt = {
  ownerId: string;
  generation: symbol;
  cancelled: boolean;
  stage: CloneAttemptStage;
  cancelProcess: (() => void) | null;
};

const activeCloneAttempts = new Map<string, ActiveCloneAttempt>();
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function readErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null;
}

function clonePathIdentityMatches(
  current: ClonePathIdentity,
  expected: ClonePathIdentity,
): boolean {
  return current.device === expected.device
    && current.inode === expected.inode
    && current.changeTimeMs === expected.changeTimeMs
    && current.birthTimeMs === expected.birthTimeMs;
}

function normalizeOwnerId(userId: number | string): string | null {
  const normalized = String(userId).trim();
  return /^\d+$/.test(normalized) && Number(normalized) > 0 ? normalized : null;
}

function cancellationError(): AppError {
  return new AppError('Clone cancelled.', {
    code: 'OPERATION_CANCELLED',
    statusCode: 409,
    details: { action: 'RETRY', field: 'repositoryUrl' },
  });
}

function assertAttemptNotCancelled(attempt: ActiveCloneAttempt): void {
  if (attempt.cancelled) throw cancellationError();
}

async function inspectDestinationOnDisk(destinationPath: string): Promise<CloneDestinationState> {
  const parentPath = path.dirname(destinationPath);
  try {
    const parentStats = await stat(parentPath);
    if (!parentStats.isDirectory()) return 'unwritable';
    await access(parentPath, fsConstants.W_OK);
  } catch (error) {
    const errorCode = readErrorCode(error);
    if (['ENOENT', 'EACCES', 'EPERM', 'EROFS'].includes(errorCode ?? '')) return 'unwritable';
    throw error;
  }

  try {
    const destinationStats = await stat(destinationPath);
    if (!destinationStats.isDirectory()) return 'not_directory';
    return (await readdir(destinationPath)).length === 0 ? 'empty' : 'non_empty';
  } catch (error) {
    const errorCode = readErrorCode(error);
    if (errorCode === 'ENOENT') return 'missing';
    if (errorCode === 'EACCES' || errorCode === 'EPERM') return 'unwritable';
    throw error;
  }
}

async function finalizeCloneOnDisk(
  stagingPath: string,
  destinationPath: string,
): Promise<FinalizedClone> {
  const stagingStats = await stat(stagingPath);
  let removedExistingEmptyDirectory = false;
  try {
    const destinationState = await inspectDestinationOnDisk(destinationPath);
    if (destinationState === 'non_empty' || destinationState === 'not_directory') {
      throw new AppError('The clone destination is no longer empty.', {
        code: 'CLONE_DESTINATION_NOT_EMPTY',
        statusCode: 409,
        details: { action: 'CHOOSE_ANOTHER', field: 'destination' },
      });
    }
    if (destinationState === 'unwritable') {
      throw new AppError('The clone destination is not writable.', {
        code: 'PROJECT_PATH_NOT_WRITABLE',
        statusCode: 403,
        details: { action: 'CHOOSE_ANOTHER', field: 'destination' },
      });
    }
    if (destinationState === 'empty') {
      await rmdir(destinationPath);
      removedExistingEmptyDirectory = true;
    }
    await rename(stagingPath, destinationPath);
  } catch (error) {
    if (removedExistingEmptyDirectory) {
      try {
        await mkdir(destinationPath);
      } catch {
        // A concurrent writer may already have recreated it; never overwrite that writer.
      }
    }
    throw error;
  }

  let rolledBack = false;
  return {
    rollback: async () => {
      if (rolledBack) return;
      const destinationStats = await stat(destinationPath);
      if (destinationStats.dev !== stagingStats.dev || destinationStats.ino !== stagingStats.ino) {
        throw new AppError('Clone destination ownership changed before rollback.', {
          code: 'CLONE_ROLLBACK_OWNERSHIP_LOST',
          statusCode: 409,
        });
      }
      await rm(destinationPath, { recursive: true, force: true });
      if (removedExistingEmptyDirectory) await mkdir(destinationPath);
      rolledBack = true;
    },
  };
}

function buildGitEnvironment(authorizationHeader: string | null): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };
  if (!authorizationHeader) return environment;
  const existingCount = Number.parseInt(environment.GIT_CONFIG_COUNT || '0', 10);
  const configIndex = Number.isFinite(existingCount) && existingCount >= 0 ? existingCount : 0;
  environment.GIT_CONFIG_COUNT = String(configIndex + 1);
  environment[`GIT_CONFIG_KEY_${configIndex}`] = 'http.extraHeader';
  environment[`GIT_CONFIG_VALUE_${configIndex}`] = authorizationHeader;
  return environment;
}

/**
 * Reserves staging for the Projects clone service and its failure-path tests.
 * A failed identity read removes only the still-empty random directory; it
 * never falls back to recursive deletion without a captured inode lease.
 */
export async function reserveCloneStagingPath(
  stagingPathPrefix: string,
  fileSystem: {
    mkdtemp: (prefix: string) => Promise<string>;
    lstat: (targetPath: string) => Promise<{
      dev: number;
      ino: number;
      ctimeMs: number;
      birthtimeMs: number;
      isDirectory: () => boolean;
      isSymbolicLink: () => boolean;
    }>;
    rmdir: (targetPath: string) => Promise<void>;
  } = { mkdtemp, lstat, rmdir },
): Promise<CloneStagingReservation> {
  const stagingPath = await fileSystem.mkdtemp(stagingPathPrefix);
  try {
    const stagingStats = await fileSystem.lstat(stagingPath);
    if (!stagingStats.isDirectory() || stagingStats.isSymbolicLink()) {
      throw new AppError('Clone staging ownership changed during reservation.', {
        code: 'CLONE_STAGING_OWNERSHIP_LOST',
        statusCode: 409,
        details: { action: 'RETRY', field: 'destination' },
      });
    }
    return {
      path: stagingPath,
      identity: {
        device: stagingStats.dev,
        inode: stagingStats.ino,
        changeTimeMs: stagingStats.ctimeMs,
        birthTimeMs: stagingStats.birthtimeMs,
      },
    };
  } catch (error) {
    try {
      await fileSystem.rmdir(stagingPath);
    } catch (cleanupError) {
      if (readErrorCode(cleanupError) !== 'ENOENT') {
        throw new AppError('Clone staging was reserved, but its empty directory could not be cleaned.', {
          code: 'CLONE_CLEANUP_REQUIRED',
          statusCode: 500,
          details: { action: 'CHOOSE_ANOTHER', field: 'destination' },
        });
      }
    }

    if (error instanceof AppError) throw error;
    throw new AppError('Clone staging ownership could not be verified after reservation.', {
      code: 'CLONE_STAGING_OWNERSHIP_LOST',
      statusCode: 409,
      details: { action: 'RETRY', field: 'destination' },
    });
  }
}

const defaultDependencies: CloneProjectDependencies = {
  validatePath: validateWorkspacePath,
  inspectDestination: inspectDestinationOnDisk,
  isProjectRegistered: async (projectPath) => {
    const row = projectsDb.getProjectPath(projectPath) as { isArchived?: number } | null;
    return Boolean(row && !row.isArchived);
  },
  reserveStagingPath: reserveCloneStagingPath,
  readPathIdentity: async (targetPath) => {
    try {
      const targetStats = await lstat(targetPath);
      return {
        device: targetStats.dev,
        inode: targetStats.ino,
        changeTimeMs: targetStats.ctimeMs,
        birthTimeMs: targetStats.birthtimeMs,
      };
    } catch (error) {
      if (readErrorCode(error) === 'ENOENT') return null;
      throw error;
    }
  },
  removePath: async (targetPath) => {
    await rm(targetPath, { recursive: true, force: true });
  },
  finalizeClone: finalizeCloneOnDisk,
  getGithubTokenById: async (tokenId, userId) => {
    const tokenRow = githubTokensDb.getGithubTokenById(userId, tokenId) as
      | { github_token: string }
      | null;
    return tokenRow;
  },
  spawnGitClone: (repositoryUrl, clonePath, authorizationHeader) =>
    spawn('git', ['clone', '--progress', '--', repositoryUrl, clonePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildGitEnvironment(authorizationHeader),
    }) as unknown as GitCloneProcess,
  registerProject: async (projectPath, customName) =>
    createProject({ projectPath, customName }) as Promise<{ project: Record<string, unknown> }>,
  logError: (message, error) => console.error(message, error),
};

function parseRepositoryUrl(repositoryUrl: string): {
  kind: 'https' | 'ssh';
  host: string;
} | null {
  if (!repositoryUrl || repositoryUrl.startsWith('-') || /[\r\n\s]/.test(repositoryUrl)) return null;
  const scpMatch = repositoryUrl.match(/^[^\s@]+@([^\s:]+):[^\s]+$/);
  if (scpMatch) return { kind: 'ssh', host: scpMatch[1].toLowerCase() };
  try {
    const parsedUrl = new URL(repositoryUrl);
    if (!parsedUrl.hostname) return null;
    if (parsedUrl.protocol === 'https:') {
      if (parsedUrl.username || parsedUrl.password) return null;
      return { kind: 'https', host: parsedUrl.hostname.toLowerCase() };
    }
    if (parsedUrl.protocol === 'ssh:' && !parsedUrl.password) {
      return { kind: 'ssh', host: parsedUrl.hostname.toLowerCase() };
    }
    return null;
  } catch {
    return null;
  }
}

function buildAuthorizationHeader(host: string, token: string): string {
  const username = host === 'github.com' ? 'x-access-token' : 'oauth2';
  return `Authorization: Basic ${Buffer.from(`${username}:${token}`, 'utf8').toString('base64')}`;
}

function sanitizeGitMessage(message: string, token: string | null): string {
  if (!message || !token) return message;
  return [token, encodeURIComponent(token)].reduce((sanitized, secret) => {
    const escapedSecret = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return sanitized.replace(new RegExp(escapedSecret, 'g'), '***');
  }, message);
}

function parseProgress(message: string): CloneProgressPayload {
  const percentMatch = message.match(/(?:^|\s)(\d{1,3})%/);
  const parsedPercent = percentMatch ? Number.parseInt(percentMatch[1], 10) : null;
  const percent = parsedPercent === null ? null : Math.min(100, Math.max(0, parsedPercent));
  const normalizedMessage = message.toLowerCase();
  const phase: CloneProgressPhase = normalizedMessage.includes('receiving objects')
    ? 'receiving'
    : normalizedMessage.includes('resolving deltas')
      ? 'resolving'
      : 'cloning';
  return { phase, percent, message };
}

function cloneFailureFromGit(message: string): AppError {
  const normalizedMessage = message.toLowerCase();
  if (
    normalizedMessage.includes('authentication failed')
    || normalizedMessage.includes('could not read username')
    || normalizedMessage.includes('access denied')
    || normalizedMessage.includes('http basic: access denied')
  ) {
    return new AppError('Authentication is required to clone this repository.', {
      code: 'AUTH_REQUIRED',
      statusCode: 401,
      details: { action: 'CHANGE_CREDENTIAL', field: 'credential' },
    });
  }
  if (normalizedMessage.includes('repository not found') || normalizedMessage.includes('project not found')) {
    return new AppError('Repository not found. Check the URL and your access.', {
      code: 'REPOSITORY_NOT_FOUND',
      statusCode: 404,
      details: { action: 'CHANGE_REPOSITORY', field: 'repositoryUrl' },
    });
  }
  if (
    normalizedMessage.includes('could not resolve host')
    || normalizedMessage.includes('failed to connect')
    || normalizedMessage.includes('network is unreachable')
    || normalizedMessage.includes('connection timed out')
    || normalizedMessage.includes('could not connect')
  ) {
    return new AppError('The network is offline or the Git host is unreachable.', {
      code: 'NETWORK_OFFLINE',
      statusCode: 503,
      details: { action: 'RETRY', field: 'repositoryUrl' },
    });
  }
  if (normalizedMessage.includes('already exists') || normalizedMessage.includes('conflict')) {
    return new AppError('Git found a conflict at the destination.', {
      code: 'CLONE_CONFLICT',
      statusCode: 409,
      details: { action: 'CHOOSE_ANOTHER', field: 'destination' },
    });
  }
  return new AppError(message || 'Git clone failed.', {
    code: 'GIT_CLONE_FAILED',
    statusCode: 500,
    details: { action: 'RETRY', field: 'repositoryUrl' },
  });
}

async function cleanAttemptStaging(
  stagingPath: string,
  expectedIdentity: ClonePathIdentity,
  dependencies: CloneProjectDependencies,
): Promise<void> {
  let currentIdentity: ClonePathIdentity | null;
  try {
    currentIdentity = await dependencies.readPathIdentity(stagingPath);
  } catch (error) {
    dependencies.logError('Failed to inspect clone attempt staging path.', error);
    throw new AppError('Clone failed and its staging files could not be cleaned safely.', {
      code: 'CLONE_CLEANUP_REQUIRED',
      statusCode: 500,
      details: { action: 'CHOOSE_ANOTHER', field: 'destination' },
    });
  }

  if (!currentIdentity) return;
  if (!clonePathIdentityMatches(currentIdentity, expectedIdentity)) {
    dependencies.logError(
      'Skipped clone staging cleanup because path ownership changed.',
      new Error(stagingPath),
    );
    throw new AppError('Clone staging ownership changed before cleanup.', {
      code: 'CLONE_STAGING_OWNERSHIP_LOST',
      statusCode: 409,
      details: { action: 'RETRY', field: 'destination' },
    });
  }

  try {
    await dependencies.removePath(stagingPath);
  } catch (error) {
    dependencies.logError('Failed to clean clone attempt staging path.', error);
    throw new AppError('Clone failed and its staging files could not be cleaned safely.', {
      code: 'CLONE_CLEANUP_REQUIRED',
      statusCode: 500,
      details: { action: 'CHOOSE_ANOTHER', field: 'destination' },
    });
  }
}

async function assertStagingOwnership(
  stagingPath: string,
  expectedIdentity: ClonePathIdentity,
  dependencies: CloneProjectDependencies,
): Promise<void> {
  const currentIdentity = await dependencies.readPathIdentity(stagingPath);
  if (!currentIdentity || !clonePathIdentityMatches(currentIdentity, expectedIdentity)) {
    throw new AppError('Clone staging ownership changed before finalization.', {
      code: 'CLONE_STAGING_OWNERSHIP_LOST',
      statusCode: 409,
      details: { action: 'RETRY', field: 'destination' },
    });
  }
}

function releaseAttempt(attemptId: string, generation: symbol): void {
  const activeAttempt = activeCloneAttempts.get(attemptId);
  if (activeAttempt?.generation === generation) activeCloneAttempts.delete(attemptId);
}

/**
 * Cancels an attempt only for its authenticated owner. Finalization and
 * registration are intentionally non-cancellable because rollback may no longer be safe.
 * Route disconnects and operation handles also pass their private generation
 * so a stale or conflicting request cannot cancel another attempt generation.
 */
export function cancelCloneProjectAttempt(
  attemptId: string,
  userId: number | string,
  generation?: symbol,
): CloneCancellationResult {
  const attempt = activeCloneAttempts.get(attemptId);
  if (!attempt) return 'not_found';
  const ownerId = normalizeOwnerId(userId);
  if (!ownerId || attempt.ownerId !== ownerId) return 'forbidden';
  if (generation && attempt.generation !== generation) return 'not_found';
  if (attempt.stage === 'finalizing' || attempt.stage === 'registering' || attempt.stage === 'complete') {
    return 'too_late';
  }
  attempt.cancelled = true;
  attempt.cancelProcess?.();
  return 'cancelled';
}

/**
 * Starts an owner-bound, attempt-scoped Git clone for the Projects route. Git
 * writes only to a hidden staging directory and every destructive rollback
 * verifies that the final directory is still the inode created by this attempt.
 */
export async function startCloneProject(
  input: CloneProjectInput,
  handlers: CloneProjectEventHandlers,
  dependencies: CloneProjectDependencies = defaultDependencies,
): Promise<CloneProjectOperation> {
  const attemptId = input.attemptId.trim();
  const ownerId = normalizeOwnerId(input.userId);
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) {
    throw new AppError('A valid clone attempt id is required.', {
      code: 'INVALID_CLONE_ATTEMPT_ID',
      statusCode: 400,
      details: { action: 'RETRY', field: 'repositoryUrl' },
    });
  }
  if (!ownerId) {
    throw new AppError('Authenticated user is required.', {
      code: 'AUTHENTICATION_REQUIRED',
      statusCode: 401,
      details: { action: 'RETRY', field: 'repositoryUrl' },
    });
  }
  if (activeCloneAttempts.has(attemptId)) {
    throw new AppError('This clone attempt is already active.', {
      code: 'CLONE_ATTEMPT_CONFLICT',
      statusCode: 409,
      details: { action: 'RETRY', field: 'repositoryUrl' },
    });
  }

  const generation = input.requestGeneration ?? Symbol(attemptId);
  const attempt: ActiveCloneAttempt = {
    ownerId,
    generation,
    cancelled: false,
    stage: 'starting',
    cancelProcess: null,
  };
  activeCloneAttempts.set(attemptId, attempt);
  let stagingReservation: { path: string; identity: ClonePathIdentity } | null = null;

  try {
    const destinationPath = input.destinationPath.trim();
    const repositoryUrl = input.repositoryUrl.trim();
    const repository = parseRepositoryUrl(repositoryUrl);
    if (!destinationPath) {
      throw new AppError('A clone destination is required.', {
        code: 'INVALID_PROJECT_PATH',
        statusCode: 400,
        details: { action: 'BROWSE', field: 'destination' },
      });
    }
    if (!repository) {
      throw new AppError('Enter a valid HTTPS or SSH repository URL without embedded credentials.', {
        code: 'INVALID_REPOSITORY_URL',
        statusCode: 400,
        details: { action: 'CHANGE_REPOSITORY', field: 'repositoryUrl' },
      });
    }

    const pathValidation = await dependencies.validatePath(destinationPath);
    assertAttemptNotCancelled(attempt);
    if (!pathValidation.valid || !pathValidation.resolvedPath) {
      throw new AppError(pathValidation.error || 'Invalid clone destination.', {
        code: 'INVALID_PROJECT_PATH',
        statusCode: 400,
        details: { action: 'BROWSE', field: 'destination' },
      });
    }
    const canonicalDestination = pathValidation.resolvedPath;
    const destinationState = await dependencies.inspectDestination(canonicalDestination);
    assertAttemptNotCancelled(attempt);
    if (destinationState === 'non_empty' || destinationState === 'not_directory') {
      throw new AppError('The clone destination must be empty.', {
        code: 'CLONE_DESTINATION_NOT_EMPTY',
        statusCode: 409,
        details: { action: 'CHOOSE_ANOTHER', field: 'destination' },
      });
    }
    if (destinationState === 'unwritable') {
      throw new AppError('The clone destination is not writable.', {
        code: 'PROJECT_PATH_NOT_WRITABLE',
        statusCode: 403,
        details: { action: 'CHOOSE_ANOTHER', field: 'destination' },
      });
    }
    if (await dependencies.isProjectRegistered(canonicalDestination)) {
      throw new AppError('This clone destination is already registered as a project.', {
        code: 'PROJECT_ALREADY_EXISTS',
        statusCode: 409,
        details: { action: 'CHOOSE_ANOTHER', field: 'destination' },
      });
    }
    assertAttemptNotCancelled(attempt);

    const stagingPathPrefix = path.join(
      path.dirname(canonicalDestination),
      `.cloudcli-clone-${attemptId}-`,
    );
    assertAttemptNotCancelled(attempt);

    let githubToken: string | null = null;
    if (typeof input.githubTokenId === 'number') {
      if (repository.kind !== 'https' || repository.host !== 'github.com') {
        throw new AppError('Stored GitHub credentials can be used only with github.com HTTPS URLs.', {
          code: 'CREDENTIAL_HOST_MISMATCH',
          statusCode: 400,
          details: { action: 'CHANGE_CREDENTIAL', field: 'credential' },
        });
      }
      const storedToken = await dependencies.getGithubTokenById(input.githubTokenId, Number(ownerId));
      assertAttemptNotCancelled(attempt);
      if (!storedToken) {
        throw new AppError('The selected credential is unavailable.', {
          code: 'AUTH_REQUIRED',
          statusCode: 401,
          details: { action: 'CHANGE_CREDENTIAL', field: 'credential' },
        });
      }
      githubToken = storedToken.github_token;
    } else if (input.newGithubToken?.trim()) {
      githubToken = input.newGithubToken.trim();
    }
    if (githubToken && repository.kind !== 'https') {
      throw new AppError('Password credentials cannot be sent to an SSH repository URL.', {
        code: 'CREDENTIAL_UNSUPPORTED_FOR_SSH',
        statusCode: 400,
        details: { action: 'CHANGE_REPOSITORY', field: 'repositoryUrl' },
      });
    }
    assertAttemptNotCancelled(attempt);

    const authorizationHeader = githubToken
      ? buildAuthorizationHeader(repository.host, githubToken)
      : null;
    let stagingPath: string;
    let stagingIdentity: ClonePathIdentity;
    try {
      const reservation = await dependencies.reserveStagingPath(stagingPathPrefix);
      stagingPath = reservation.path;
      stagingIdentity = reservation.identity;
      stagingReservation = reservation;
    } catch (error) {
      if (readErrorCode(error) === 'EEXIST') {
        throw new AppError('Clone attempt staging already exists.', {
          code: 'CLONE_ATTEMPT_CONFLICT',
          statusCode: 409,
          details: { action: 'RETRY', field: 'destination' },
        });
      }
      throw error;
    }
    assertAttemptNotCancelled(attempt);
    handlers.onProgress({ phase: 'preparing', percent: 0, message: 'Preparing clone destination…' });
    const gitProcess = dependencies.spawnGitClone(repositoryUrl, stagingPath, authorizationHeader);
    attempt.stage = 'cloning';
    attempt.cancelProcess = () => gitProcess.kill();
    if (attempt.cancelled) gitProcess.kill();
    handlers.onProgress({ phase: 'cloning', percent: 0, message: 'Connecting to repository…' });

    let lastError = '';
    let settled = false;
    const emitChunk = (chunk: Buffer | string, isError: boolean) => {
      for (const rawLine of chunk.toString().split(/[\r\n]+/)) {
        const message = sanitizeGitMessage(rawLine.trim(), githubToken);
        if (!message) continue;
        if (isError) lastError = message;
        handlers.onProgress(parseProgress(message));
      }
    };
    gitProcess.stdout?.on('data', (data: Buffer | string) => emitChunk(data, false));
    gitProcess.stderr?.on('data', (data: Buffer | string) => emitChunk(data, true));

    const waitForCompletion = new Promise<void>((resolve, reject) => {
      const rejectAfterCleanup = async (error: AppError) => {
        if (settled) return;
        settled = true;
        try {
          await cleanAttemptStaging(stagingPath, stagingIdentity, dependencies);
          reject(error);
        } catch (cleanupError) {
          reject(cleanupError);
        }
      };

      gitProcess.on('close', (code) => {
        void (async () => {
          if (settled) return;
          if (attempt.cancelled) {
            await rejectAfterCleanup(cancellationError());
            return;
          }
          if (code !== 0) {
            await rejectAfterCleanup(cloneFailureFromGit(lastError));
            return;
          }

          let finalizedClone: FinalizedClone | null = null;
          try {
            attempt.stage = 'finalizing';
            handlers.onProgress({ phase: 'finalizing', percent: null, message: 'Finalizing destination…' });
            await assertStagingOwnership(stagingPath, stagingIdentity, dependencies);
            finalizedClone = await dependencies.finalizeClone(stagingPath, canonicalDestination);
            attempt.stage = 'registering';
            handlers.onProgress({ phase: 'registering', percent: null, message: 'Adding project…' });
            const projectName = path.basename(canonicalDestination) || 'repository';
            const createdProject = await dependencies.registerProject(canonicalDestination, projectName);
            attempt.stage = 'complete';
            settled = true;
            handlers.onComplete({
              project: createdProject.project,
              message: 'Repository cloned successfully',
            });
            resolve();
          } catch (error) {
            if (!finalizedClone) {
              await rejectAfterCleanup(error instanceof AppError
                ? error
                : new AppError('Clone finalization failed.', {
                    code: 'CLONE_CONFLICT',
                    statusCode: 409,
                    details: { action: 'CHOOSE_ANOTHER', field: 'destination' },
                  }));
              return;
            }

            try {
              await finalizedClone.rollback();
            } catch (rollbackError) {
              dependencies.logError('Failed to roll back finalized clone destination.', rollbackError);
              settled = true;
              reject(new AppError('The repository was cloned but could not be registered or rolled back.', {
                code: 'CLONE_REPAIR_REQUIRED',
                statusCode: 500,
                details: { action: 'OPEN_EXISTING', field: 'destination' },
              }));
              return;
            }

            settled = true;
            const registrationError = error instanceof AppError && error.code === 'PROJECT_ALREADY_EXISTS'
              ? new AppError(error.message, {
                  code: 'PROJECT_ALREADY_EXISTS',
                  statusCode: 409,
                  details: { action: 'CHOOSE_ANOTHER', field: 'destination' },
                })
              : new AppError('The repository cloned, but project registration failed. The destination was restored.', {
                  code: 'CLONE_PROJECT_REGISTRATION_FAILED',
                  statusCode: 500,
                  details: { action: 'RETRY', field: 'destination' },
                });
            reject(registrationError);
          }
        })();
      });

      gitProcess.on('error', (error) => {
        const appError = error.code === 'ENOENT'
          ? new AppError('Git is not installed or is not available in PATH.', {
              code: 'GIT_NOT_FOUND',
              statusCode: 503,
              details: { action: 'INSTALL_GIT', field: 'repositoryUrl' },
            })
          : new AppError(error.message || 'Git could not start.', {
              code: 'GIT_EXECUTION_FAILED',
              statusCode: 500,
              details: { action: 'RETRY', field: 'repositoryUrl' },
            });
        void rejectAfterCleanup(appError);
      });
    });

    return {
      attemptId,
      waitForCompletion,
      cancel: () => cancelCloneProjectAttempt(attemptId, ownerId, generation),
      release: () => releaseAttempt(attemptId, generation),
    };
  } catch (error) {
    if (stagingReservation) {
      try {
        await cleanAttemptStaging(
          stagingReservation.path,
          stagingReservation.identity,
          dependencies,
        );
      } catch (cleanupError) {
        releaseAttempt(attemptId, generation);
        throw cleanupError;
      }
    }
    releaseAttempt(attemptId, generation);
    throw error;
  }
}
