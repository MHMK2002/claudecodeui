export type WizardStep = 1 | 2 | 3;

export type ProjectCreationMode = 'local' | 'clone';

export type TokenMode = 'stored' | 'new' | 'none';

export type ProjectCreationField =
  | 'folder'
  | 'repositoryUrl'
  | 'destination'
  | 'credential';

export type ProjectCreationRecoveryAction =
  | 'BROWSE'
  | 'CHOOSE_ANOTHER'
  | 'INSTALL_GIT'
  | 'CHANGE_CREDENTIAL'
  | 'CHANGE_REPOSITORY'
  | 'OPEN_EXISTING'
  | 'RETRY';

export type ProjectCreationErrorCode =
  | 'INVALID_PROJECT_PATH'
  | 'PROJECT_PATH_NOT_WRITABLE'
  | 'CLONE_DESTINATION_NOT_EMPTY'
  | 'PROJECT_ALREADY_EXISTS'
  | 'GIT_NOT_FOUND'
  | 'INVALID_REPOSITORY_URL'
  | 'AUTH_REQUIRED'
  | 'REPOSITORY_NOT_FOUND'
  | 'NETWORK_OFFLINE'
  | 'CLONE_CONFLICT'
  | 'OPERATION_CANCELLED'
  | 'INVALID_CLONE_ATTEMPT_ID'
  | 'AUTHENTICATION_REQUIRED'
  | 'CLONE_ATTEMPT_CONFLICT'
  | 'CREDENTIAL_HOST_MISMATCH'
  | 'CREDENTIAL_UNSUPPORTED_FOR_SSH'
  | 'CLONE_PROJECT_REGISTRATION_FAILED'
  | 'CLONE_CLEANUP_REQUIRED'
  | 'CLONE_STAGING_OWNERSHIP_LOST'
  | 'CLONE_ROLLBACK_OWNERSHIP_LOST'
  | 'CLONE_REPAIR_REQUIRED'
  | 'GIT_EXECUTION_FAILED'
  | 'GIT_CLONE_FAILED'
  | 'UNKNOWN';

export type ProjectCreationErrorPresentation = {
  code: ProjectCreationErrorCode;
  message: string;
  action: ProjectCreationRecoveryAction;
  field: ProjectCreationField;
  attemptId?: string;
};

export type FolderSuggestion = {
  name: string;
  path: string;
  type?: string;
};

export type GithubTokenCredential = {
  id: number;
  credential_name: string;
  is_active: boolean;
};

export type CredentialsResponse = {
  credentials?: GithubTokenCredential[];
  error?: string;
};

export type BrowseFilesystemResponse = {
  path?: string;
  suggestions?: FolderSuggestion[];
  error?: string;
};

export type CreateFolderResponse = {
  success?: boolean;
  path?: string;
  error?: string;
  details?: string;
};

export type CreateProjectPayload = {
  path: string;
  customName?: string;
};

export type CreateProjectApiError = {
  code?: string;
  message?: string;
  details?: {
    action?: string;
    field?: string;
    [key: string]: unknown;
  } | string;
};

export type CreateProjectResponse = {
  success?: boolean;
  project?: Record<string, unknown>;
  error?: string | CreateProjectApiError;
  details?: string;
  message?: string;
};

export type CloneProgressPhase =
  | 'preparing'
  | 'cloning'
  | 'receiving'
  | 'resolving'
  | 'finalizing'
  | 'registering';

export type CloneProgress = {
  phase: CloneProgressPhase;
  percent: number | null;
  message: string;
};

export type CloneProgressEvent = {
  type?: 'attempt' | 'progress' | 'complete' | 'error';
  attemptId?: string;
  phase?: CloneProgressPhase;
  percent?: number | null;
  message?: string;
  code?: string;
  action?: string;
  field?: string;
  project?: Record<string, unknown>;
};

export type WizardFormState = {
  mode: ProjectCreationMode | null;
  folderPath: string;
  repositoryUrl: string;
  destinationRoot: string;
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
};
