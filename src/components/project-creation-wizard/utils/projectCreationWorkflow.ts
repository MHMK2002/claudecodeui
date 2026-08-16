import type {
  ProjectCreationErrorCode,
  ProjectCreationErrorPresentation,
  ProjectCreationField,
  ProjectCreationMode,
  ProjectCreationRecoveryAction,
  WizardStep,
} from '../types';

type ConfigurationField = ProjectCreationField;

const FALLBACK_PRESENTATION: ProjectCreationErrorPresentation = {
  code: 'UNKNOWN',
  message: 'The project could not be opened. Review the details and try again.',
  action: 'RETRY',
  field: 'folder',
};

const ERROR_PRESENTATIONS: Record<
  Exclude<ProjectCreationErrorCode, 'UNKNOWN'>,
  Omit<ProjectCreationErrorPresentation, 'code'>
> = {
  INVALID_PROJECT_PATH: {
    message: 'Choose an existing folder inside the allowed workspace location.',
    action: 'BROWSE',
    field: 'folder',
  },
  PROJECT_PATH_NOT_WRITABLE: {
    message: 'The selected folder is not writable.',
    action: 'CHOOSE_ANOTHER',
    field: 'folder',
  },
  CLONE_DESTINATION_NOT_EMPTY: {
    message: 'The clone destination already contains files.',
    action: 'CHOOSE_ANOTHER',
    field: 'destination',
  },
  PROJECT_ALREADY_EXISTS: {
    message: 'This folder is already registered as a project.',
    action: 'CHOOSE_ANOTHER',
    field: 'folder',
  },
  GIT_NOT_FOUND: {
    message: 'Git is not installed or is unavailable in PATH.',
    action: 'INSTALL_GIT',
    field: 'repositoryUrl',
  },
  INVALID_REPOSITORY_URL: {
    message: 'Enter a valid HTTPS or SSH repository URL.',
    action: 'CHANGE_REPOSITORY',
    field: 'repositoryUrl',
  },
  AUTH_REQUIRED: {
    message: 'This repository requires a credential.',
    action: 'CHANGE_CREDENTIAL',
    field: 'credential',
  },
  REPOSITORY_NOT_FOUND: {
    message: 'The repository was not found. Check its URL and your access.',
    action: 'CHANGE_REPOSITORY',
    field: 'repositoryUrl',
  },
  NETWORK_OFFLINE: {
    message: 'The Git host is unreachable. Check your connection and retry.',
    action: 'RETRY',
    field: 'repositoryUrl',
  },
  CLONE_CONFLICT: {
    message: 'Git found a conflict at the selected destination.',
    action: 'CHOOSE_ANOTHER',
    field: 'destination',
  },
  OPERATION_CANCELLED: {
    message: 'The clone was cancelled. Your selected values were preserved.',
    action: 'RETRY',
    field: 'repositoryUrl',
  },
  INVALID_CLONE_ATTEMPT_ID: {
    message: 'The clone attempt could not be started safely.',
    action: 'RETRY',
    field: 'repositoryUrl',
  },
  AUTHENTICATION_REQUIRED: {
    message: 'Your local session must be restored before the clone can continue.',
    action: 'RETRY',
    field: 'repositoryUrl',
  },
  CLONE_ATTEMPT_CONFLICT: {
    message: 'A clone with this attempt identifier is already active.',
    action: 'RETRY',
    field: 'repositoryUrl',
  },
  CREDENTIAL_HOST_MISMATCH: {
    message: 'The selected credential cannot be used with this repository host.',
    action: 'CHANGE_CREDENTIAL',
    field: 'credential',
  },
  CREDENTIAL_UNSUPPORTED_FOR_SSH: {
    message: 'Password credentials cannot be used with an SSH repository URL.',
    action: 'CHANGE_REPOSITORY',
    field: 'repositoryUrl',
  },
  CLONE_PROJECT_REGISTRATION_FAILED: {
    message: 'The project could not be registered, and the clone destination was restored.',
    action: 'RETRY',
    field: 'destination',
  },
  CLONE_CLEANUP_REQUIRED: {
    message: 'Clone staging files could not be cleaned safely. Choose another destination.',
    action: 'CHOOSE_ANOTHER',
    field: 'destination',
  },
  CLONE_STAGING_OWNERSHIP_LOST: {
    message: 'The clone staging folder changed before finalization.',
    action: 'RETRY',
    field: 'destination',
  },
  CLONE_ROLLBACK_OWNERSHIP_LOST: {
    message: 'The cloned destination changed before it could be restored safely.',
    action: 'OPEN_EXISTING',
    field: 'destination',
  },
  CLONE_REPAIR_REQUIRED: {
    message: 'The repository was cloned, but registration and automatic cleanup both failed.',
    action: 'OPEN_EXISTING',
    field: 'destination',
  },
  GIT_EXECUTION_FAILED: {
    message: 'Git could not be started for this clone.',
    action: 'RETRY',
    field: 'repositoryUrl',
  },
  GIT_CLONE_FAILED: {
    message: 'Git could not clone this repository.',
    action: 'RETRY',
    field: 'repositoryUrl',
  },
};

export function getProjectConfigurationFields(
  mode: ProjectCreationMode,
  credentialRequired: boolean,
): ConfigurationField[] {
  if (mode === 'local') return ['folder'];
  return credentialRequired
    ? ['repositoryUrl', 'destination', 'credential']
    : ['repositoryUrl', 'destination'];
}

export function getRepositoryName(repositoryUrl: string): string | null {
  const trimmedUrl = repositoryUrl.trim();
  if (!trimmedUrl || trimmedUrl.startsWith('-') || /[\r\n\s]/.test(trimmedUrl)) return null;

  const scpStyleSsh = trimmedUrl.match(/^[^\s@]+@[^\s:]+:([^\s]+)$/);
  let pathPart = scpStyleSsh?.[1] ?? '';
  if (!scpStyleSsh) {
    try {
      const parsedUrl = new URL(trimmedUrl);
      const isHttps = parsedUrl.protocol === 'https:'
        && !parsedUrl.username
        && !parsedUrl.password;
      const isSsh = parsedUrl.protocol === 'ssh:' && !parsedUrl.password;
      if (!parsedUrl.hostname || (!isHttps && !isSsh)) return null;
      pathPart = parsedUrl.pathname;
    } catch {
      return null;
    }
  }

  const name = pathPart
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter(Boolean)
    .pop()
    ?.replace(/\.git$/i, '') ?? '';
  return name.trim() || null;
}

export function shouldResetCredentialChallenge(
  previousRepositoryUrl: string,
  nextRepositoryUrl: string,
): boolean {
  return previousRepositoryUrl.trim() !== nextRepositoryUrl.trim();
}

export function buildCloneDestination(destinationRoot: string, repositoryUrl: string): string {
  const root = destinationRoot.trim().replace(/[\\/]+$/, '');
  const repositoryName = getRepositoryName(repositoryUrl);
  if (!root || !repositoryName) return '';
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root}${separator}${repositoryName}`;
}

export function getProjectErrorPresentation(
  rawCode: unknown,
  serverMessage?: unknown,
): ProjectCreationErrorPresentation {
  const code = typeof rawCode === 'string'
    && Object.prototype.hasOwnProperty.call(ERROR_PRESENTATIONS, rawCode)
    ? rawCode as Exclude<ProjectCreationErrorCode, 'UNKNOWN'>
    : 'UNKNOWN';
  const base = code === 'UNKNOWN' ? FALLBACK_PRESENTATION : { code, ...ERROR_PRESENTATIONS[code] };
  return {
    ...base,
    message: typeof serverMessage === 'string' && serverMessage.trim()
      ? serverMessage.trim()
      : base.message,
  };
}

export function getRecoveryActionLabel(action: ProjectCreationRecoveryAction): string {
  switch (action) {
    case 'BROWSE': return 'Browse folders';
    case 'CHOOSE_ANOTHER': return 'Choose another folder';
    case 'INSTALL_GIT': return 'Install Git';
    case 'CHANGE_CREDENTIAL': return 'Change credential';
    case 'CHANGE_REPOSITORY': return 'Change repository URL';
    case 'OPEN_EXISTING': return 'Open existing folder';
    case 'RETRY': return 'Retry';
  }
}

export function getProjectErrorRecoveryStep(
  action: ProjectCreationRecoveryAction,
): Extract<WizardStep, 2 | 3> {
  return action === 'RETRY' ? 3 : 2;
}
