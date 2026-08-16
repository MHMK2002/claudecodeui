import { api } from '../../../utils/api';
import { getProjectErrorPresentation } from '../utils/projectCreationWorkflow';
import type {
  BrowseFilesystemResponse,
  CloneProgress,
  CloneProgressEvent,
  CreateFolderResponse,
  CreateProjectPayload,
  CreateProjectResponse,
  CredentialsResponse,
  FolderSuggestion,
  ProjectCreationErrorPresentation,
  ProjectCreationField,
  ProjectCreationRecoveryAction,
  TokenMode,
} from '../types';

type CloneWorkspaceParams = {
  attemptId: string;
  destinationPath: string;
  repositoryUrl: string;
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
  signal?: AbortSignal;
};

type CloneProgressHandlers = {
  onProgress: (progress: CloneProgress) => void;
};

export type CloneCancellationResult = 'cancelled' | 'not_found' | 'too_late';

export class ProjectCreationRequestError extends Error {
  readonly code: string;
  readonly action: string;
  readonly field: string;
  readonly attemptId?: string;

  constructor(presentation: ProjectCreationErrorPresentation) {
    super(presentation.message);
    this.name = 'ProjectCreationRequestError';
    this.code = presentation.code;
    this.action = presentation.action;
    this.field = presentation.field;
    this.attemptId = presentation.attemptId;
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return null;
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

const RECOVERY_ACTIONS = new Set<ProjectCreationRecoveryAction>([
  'BROWSE',
  'CHOOSE_ANOTHER',
  'INSTALL_GIT',
  'CHANGE_CREDENTIAL',
  'CHANGE_REPOSITORY',
  'OPEN_EXISTING',
  'RETRY',
]);

const RECOVERY_FIELDS = new Set<ProjectCreationField>([
  'folder',
  'repositoryUrl',
  'destination',
  'credential',
]);

function readRecoveryAction(
  value: unknown,
  fallback: ProjectCreationRecoveryAction,
): ProjectCreationRecoveryAction {
  return typeof value === 'string' && RECOVERY_ACTIONS.has(value as ProjectCreationRecoveryAction)
    ? value as ProjectCreationRecoveryAction
    : fallback;
}

function readRecoveryField(
  value: unknown,
  fallback: ProjectCreationField,
): ProjectCreationField {
  return typeof value === 'string' && RECOVERY_FIELDS.has(value as ProjectCreationField)
    ? value as ProjectCreationField
    : fallback;
}

function requestErrorFromResponse(
  responseData: CreateProjectResponse | null,
  fallbackMessage: string,
): ProjectCreationRequestError {
  const errorObject = responseData?.error && typeof responseData.error === 'object'
    ? responseData.error
    : null;
  const details = errorObject?.details && typeof errorObject.details === 'object'
    ? errorObject.details
    : null;
  const message = errorObject?.message
    || (typeof responseData?.error === 'string' ? responseData.error : '')
    || responseData?.details
    || responseData?.message
    || fallbackMessage;
  const presentation = getProjectErrorPresentation(errorObject?.code || 'UNKNOWN', message);
  return new ProjectCreationRequestError({
    ...presentation,
    action: readRecoveryAction(details?.action, presentation.action),
    field: readRecoveryField(details?.field, presentation.field),
  });
}

export const fetchGithubTokenCredentials = async () => {
  const response = await api.get('/settings/credentials?type=github_token');
  const data = await parseJsonResponse<CredentialsResponse>(response);
  if (!response.ok) throw new Error(data?.error || 'Failed to load stored credentials');
  return (data?.credentials || []).filter((credential) => credential.is_active);
};

export const browseFilesystemFolders = async (pathToBrowse: string) => {
  const endpoint = `/file-tree/browse-filesystem?path=${encodeURIComponent(pathToBrowse)}`;
  const response = await api.get(endpoint);
  const data = await parseJsonResponse<BrowseFilesystemResponse>(response);
  if (!response.ok) throw new Error(data?.error || 'Failed to browse filesystem');
  return {
    path: data?.path || pathToBrowse,
    suggestions: (data?.suggestions || []) as FolderSuggestion[],
  };
};

export const createFolderInFilesystem = async (folderPath: string) => {
  const response = await api.createFolder(folderPath);
  const data = await parseJsonResponse<CreateFolderResponse>(response);
  if (!response.ok) throw new Error(data?.error || 'Failed to create folder');
  return data?.path || folderPath;
};

export const createProjectRequest = async (payload: CreateProjectPayload) => {
  const response = await api.createProject(payload);
  const data = await parseJsonResponse<CreateProjectResponse>(response);
  if (!response.ok) throw requestErrorFromResponse(data, 'Failed to open project');
  return data?.project;
};

function buildCloneProgressBody(params: CloneWorkspaceParams) {
  const body: Record<string, string> = {
    attemptId: params.attemptId,
    destinationPath: params.destinationPath.trim(),
    repositoryUrl: params.repositoryUrl.trim(),
  };
  if (params.tokenMode === 'stored' && params.selectedGithubToken) {
    body.githubTokenId = params.selectedGithubToken;
  }
  if (params.tokenMode === 'new' && params.newGithubToken.trim()) {
    body.newGithubToken = params.newGithubToken.trim();
  }
  return body;
}

function errorFromCloneEvent(payload: CloneProgressEvent): ProjectCreationRequestError {
  const presentation = getProjectErrorPresentation(payload.code || 'GIT_CLONE_FAILED', payload.message);
  return new ProjectCreationRequestError({
    ...presentation,
    action: readRecoveryAction(payload.action, presentation.action),
    field: readRecoveryField(payload.field, presentation.field),
    attemptId: payload.attemptId,
  });
}

const CLONE_PROGRESS_PHASES = new Set<CloneProgress['phase']>([
  'preparing',
  'cloning',
  'receiving',
  'resolving',
  'finalizing',
  'registering',
]);

function invalidCloneStreamError(): ProjectCreationRequestError {
  return new ProjectCreationRequestError(getProjectErrorPresentation(
    'GIT_CLONE_FAILED',
    'The clone stream returned invalid data.',
  ));
}

function parseCloneProgressEvent(value: unknown): CloneProgressEvent {
  if (typeof value !== 'object' || value === null) throw invalidCloneStreamError();
  const payload = value as Record<string, unknown>;
  if (payload.type === 'attempt') {
    if (typeof payload.attemptId !== 'string') throw invalidCloneStreamError();
  } else if (payload.type === 'progress') {
    if (
      typeof payload.phase !== 'string'
      || !CLONE_PROGRESS_PHASES.has(payload.phase as CloneProgress['phase'])
      || typeof payload.message !== 'string'
      || (payload.percent !== null
        && (typeof payload.percent !== 'number' || !Number.isFinite(payload.percent)))
    ) {
      throw invalidCloneStreamError();
    }
  } else if (payload.type === 'error') {
    if (typeof payload.code !== 'string' || typeof payload.message !== 'string') {
      throw invalidCloneStreamError();
    }
  } else if (payload.type === 'complete') {
    if (
      typeof payload.project !== 'object'
      || payload.project === null
      || Array.isArray(payload.project)
    ) {
      throw invalidCloneStreamError();
    }
    const project = payload.project as Record<string, unknown>;
    if (
      typeof project.projectId !== 'string'
      || !project.projectId.trim()
      || typeof project.path !== 'string'
      || !project.path.trim()
    ) throw invalidCloneStreamError();
  } else {
    throw invalidCloneStreamError();
  }
  return payload as CloneProgressEvent;
}

export const cloneWorkspaceWithProgress = async (
  params: CloneWorkspaceParams,
  handlers: CloneProgressHandlers,
) => {
  const response = await api.post(
    '/projects/clone-progress',
    buildCloneProgressBody(params),
    { signal: params.signal },
  );
  if (!response.ok || !response.body) {
    const data = await parseJsonResponse<CreateProjectResponse>(response);
    throw requestErrorFromResponse(data, `Failed to start clone (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleEvent = (rawEvent: string): Record<string, unknown> | undefined => {
    const eventData = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!eventData) return undefined;
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(eventData) as unknown;
    } catch {
      throw invalidCloneStreamError();
    }
    const payload = parseCloneProgressEvent(parsedPayload);
    if (payload.type === 'progress' && payload.message && payload.phase) {
      handlers.onProgress({
        phase: payload.phase,
        percent: typeof payload.percent === 'number' ? payload.percent : null,
        message: payload.message,
      });
      return undefined;
    }
    if (payload.type === 'error') throw errorFromCloneEvent(payload);
    return payload.type === 'complete' ? payload.project : undefined;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';
    for (const rawEvent of events) {
      const project = handleEvent(rawEvent);
      if (project) {
        await reader.cancel();
        return project;
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const project = handleEvent(buffer);
    if (project) return project;
  }
  throw new ProjectCreationRequestError(getProjectErrorPresentation(
    'NETWORK_OFFLINE',
    'The clone connection ended before completion.',
  ));
};

export async function cancelCloneAttempt(attemptId: string): Promise<CloneCancellationResult> {
  const response = await api.delete(`/projects/clone-attempts/${encodeURIComponent(attemptId)}`);
  if (response.ok) return 'cancelled';
  if (response.status === 404) return 'not_found';
  if (response.status === 409) return 'too_late';

  const data = await parseJsonResponse<CreateProjectResponse>(response);
  throw requestErrorFromResponse(data, 'Failed to cancel clone attempt');
}
