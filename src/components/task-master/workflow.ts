import type { MarkSessionProcessing } from '../../hooks/useSessionProtection';
import type {
  LLMProvider,
  Project,
  ProviderSelectionCatalog,
  ResolvedProviderSelection,
} from '../../types/app';
import { authenticatedFetch } from '../../utils/api';
import type { SessionEstablishedContext } from '../chat/types/types';

import type { TaskMasterTask } from './types';
import { runSingleFlight } from './single-flight';

export type ProviderSelection = ResolvedProviderSelection;

export type TaskWorkflowCallbacks = {
  sendMessage: (message: unknown) => void;
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onNavigateToSession?: (sessionId: string) => void;
  onSessionProcessing?: MarkSessionProcessing;
};

type IntakeProposal = {
  intakeId: string;
  title: string;
  description: string;
  details: string;
  testStrategy: string;
  priority: string;
  dependencies: string[];
  subtasks: Array<Record<string, unknown>>;
  clarificationAnswers: Array<Record<string, unknown>>;
  acceptedDecisions: Array<Record<string, unknown>>;
  acceptanceCriteria: string[];
  unresolvedQuestions: string[];
  projectMetadata: Record<string, unknown>;
  taskMetadata: Record<string, unknown>;
};

export type TaskIntakeRecord = {
  id: string;
  sessionId?: string | null;
  status: string;
  brief: string;
  proposal: IntakeProposal | null;
  proposalHash: string | null;
  proposalReady: boolean;
  proposalError: string | null;
  approvalStatus: string | null;
  taskId: string | null;
  createdAt: string;
};

type LaunchAttempt = {
  id: string;
  taskId: string;
  sessionId?: string | null;
  status: string;
  content: string;
  contentHash: string;
  failure?: string;
};

const PROVIDERS: LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];
const FALLBACK_DEFAULT_MODEL: Record<LLMProvider, string> = {
  claude: 'default',
  cursor: 'gpt-5.3-codex',
  codex: 'gpt-5.4',
  opencode: 'anthropic/claude-sonnet-4-5',
};

function readPositiveInteger(value: string | null): number | null {
  if (!value || value === 'local' || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function readCurrentProviderSelection(): ProviderSelection {
  const storedProvider = localStorage.getItem('selected-provider');
  const provider = PROVIDERS.includes(storedProvider as LLMProvider)
    ? storedProvider as LLMProvider
    : 'claude';
  const providerProfileId = provider === 'claude'
    ? readPositiveInteger(localStorage.getItem('claude-provider-profile-id'))
    : provider === 'codex'
      ? readPositiveInteger(localStorage.getItem('codex-provider-profile-id'))
      : null;
  const model = localStorage.getItem(`${provider}-model`)?.trim() || FALLBACK_DEFAULT_MODEL[provider];
  return { provider, providerProfileId, model };
}

function resolveCatalogTaskSelection(
  catalog: ProviderSelectionCatalog,
  preferred: ProviderSelection,
): ProviderSelection | null {
  const ordered = [
    ...catalog.providers.filter((entry) => entry.provider === preferred.provider),
    ...catalog.providers.filter((entry) => entry.provider !== preferred.provider),
  ];
  for (const entry of ordered) {
    if (!entry.available) continue;
    const usesProfile = entry.provider === 'claude' || entry.provider === 'codex';
    const preferredProfile = usesProfile
      ? entry.profiles.find((profile) => profile.id === preferred.providerProfileId)
      : null;
    const profileId = usesProfile
      ? (preferredProfile ?? entry.profiles.find((profile) => profile.isDefault) ?? entry.profiles[0])?.id ?? null
      : null;
    if (usesProfile && profileId === null) continue;
    const model = entry.models.OPTIONS.some((option) => option.value === preferred.model)
      ? preferred.model
      : entry.models.DEFAULT || entry.models.OPTIONS[0]?.value;
    if (!model) continue;
    return { provider: entry.provider, providerProfileId: profileId, model };
  }
  return null;
}

async function readSettingsProviderSelection(): Promise<ProviderSelection> {
  const response = await authenticatedFetch('/api/providers/selection-catalog');
  const catalog = await readResponse<ProviderSelectionCatalog>(response);
  const selection = resolveCatalogTaskSelection(catalog, readCurrentProviderSelection());
  if (!selection) {
    throw new Error('Configure an available provider, profile, and model in Settings first.');
  }
  return selection;
}

/**
 * Storage key for the task Q&A runtime selection. Deliberately independent of
 * the chat/implementation preferences: picking a Q&A provider never changes
 * what new chats or task implementations run with.
 */
const TASK_QA_SELECTION_STORAGE_KEY = 'task-qa-provider-selection';

type StoredTaskQaSelection = {
  provider: LLMProvider;
  providerProfileId: number | null;
  model: string;
};

/**
 * Persists the Q&A runtime selection under its own key.
 *
 * Callers should only invoke this after the selection has been validated
 * against the catalog, so restores are trustworthy; `readStoredTaskQaSelection`
 * still re-validates on restore.
 */
export function writeStoredTaskQaSelection(selection: StoredTaskQaSelection): void {
  localStorage.setItem(
    TASK_QA_SELECTION_STORAGE_KEY,
    JSON.stringify({
      provider: selection.provider,
      providerProfileId: selection.providerProfileId,
      model: selection.model,
    }),
  );
}

/**
 * Reads the stored Q&A selection. Returns null when nothing is stored or the
 * payload is malformed — callers then fall back to the catalog-based default.
 * The value is NOT re-validated here (that needs the catalog); callers pass it
 * through `resolveValidSelection` and fall back when it returns null.
 */
export function readStoredTaskQaSelection(): StoredTaskQaSelection | null {
  const raw = localStorage.getItem(TASK_QA_SELECTION_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTaskQaSelection>;
    if (
      !PROVIDERS.includes(parsed.provider as LLMProvider)
      || typeof parsed.model !== 'string'
      || !parsed.model.trim()
    ) {
      return null;
    }
    return {
      provider: parsed.provider as LLMProvider,
      providerProfileId: typeof parsed.providerProfileId === 'number' ? parsed.providerProfileId : null,
      model: parsed.model,
    };
  } catch {
    return null;
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as {
    success?: boolean;
    data?: T;
    message?: string;
    error?: string;
  };
  if (!response.ok || body.success === false || !body.data) {
    throw new Error(body.message || body.error || `Request failed (${response.status})`);
  }
  return body.data;
}

function projectPath(project: Project): string {
  const value = project.fullPath || project.path || '';
  if (!value) {
    throw new Error('Project path is unavailable.');
  }
  return value;
}

function projectId(project: Project): string {
  if (!project.projectId) {
    throw new Error('Project ID is unavailable.');
  }
  return project.projectId;
}

async function allocateSession(project: Project, selection: ProviderSelection): Promise<string> {
  const response = await authenticatedFetch('/api/providers/sessions', {
    method: 'POST',
    body: JSON.stringify({
      provider: selection.provider,
      projectPath: projectPath(project),
      providerProfileId: selection.providerProfileId,
      model: selection.model,
    }),
  });
  const data = await readResponse<{ sessionId: string }>(response);
  if (!data.sessionId) {
    throw new Error('The session gateway did not return a session ID.');
  }
  return data.sessionId;
}

async function discardUnboundSession(sessionId: string): Promise<void> {
  try {
    await authenticatedFetch(`/api/providers/sessions/${encodeURIComponent(sessionId)}?force=true`, {
      method: 'DELETE',
    });
  } catch {
    // Cleanup is best-effort. Preserve the original workflow error so callers
    // receive the actionable failure instead of a secondary deletion failure.
  }
}

export async function listTaskIntakes(project: Project): Promise<TaskIntakeRecord[]> {
  const response = await authenticatedFetch(`/api/taskmaster/workflow/${encodeURIComponent(projectId(project))}/intakes`);
  const data = await readResponse<{ intakes: TaskIntakeRecord[] }>(response);
  return data.intakes;
}

export async function startTaskIntake(args: {
  project: Project;
  brief: string;
  selection?: ProviderSelection;
} & TaskWorkflowCallbacks): Promise<{ intakeId: string; sessionId: string }> {
  const selection = args.selection ?? await readSettingsProviderSelection();
  const targetProjectId = projectId(args.project);
  const sessionId = await allocateSession(args.project, selection);
  let created: { intake: { id: string } };
  try {
    const createResponse = await authenticatedFetch(
      `/api/taskmaster/workflow/${encodeURIComponent(targetProjectId)}/intakes`,
      {
        method: 'POST',
        body: JSON.stringify({
          brief: args.brief,
          provider: selection.provider,
          providerProfileId: selection.providerProfileId,
        }),
      },
    );
    created = await readResponse<{ intake: { id: string } }>(createResponse);
  } catch (error) {
    await discardUnboundSession(sessionId);
    throw error;
  }

  const bindResponse = await authenticatedFetch(
    `/api/taskmaster/workflow/${encodeURIComponent(targetProjectId)}/intakes/${encodeURIComponent(created.intake.id)}/bind`,
    {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    },
  );
  const bound = await readResponse<{
    intake: { prompt: string; contentHash: string };
  }>(bindResponse);

  args.onSessionProcessing?.(sessionId, { statusText: 'Starting task intake…', canInterrupt: true });
  args.sendMessage({
    type: 'chat.send',
    sessionId,
    content: bound.intake.prompt,
    workflow: {
      kind: 'intake',
      id: created.intake.id,
      contentHash: bound.intake.contentHash,
    },
    options: { model: selection.model },
  });
  const context: SessionEstablishedContext = {
    provider: selection.provider,
    project: args.project,
    summary: `Task intake: ${args.brief.slice(0, 80)}`,
  };
  args.onSessionEstablished?.(sessionId, context);
  args.onNavigateToSession?.(sessionId);
  return { intakeId: created.intake.id, sessionId };
}

export async function approveTaskIntake(args: {
  project: Project;
  intake: TaskIntakeRecord;
  idempotencyKey?: string;
}): Promise<TaskMasterTask> {
  if (!args.intake.proposalReady || !args.intake.proposalHash) {
    throw new Error('Resolve every material question before approval.');
  }
  const idempotencyKey = args.idempotencyKey
    ?? `approve:${args.intake.id}:${args.intake.proposalHash.slice(0, 24)}`;
  const response = await authenticatedFetch(
    `/api/taskmaster/workflow/${encodeURIComponent(projectId(args.project))}/intakes/${encodeURIComponent(args.intake.id)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({
        approved: true,
        proposalHash: args.intake.proposalHash,
        idempotencyKey,
      }),
    },
  );
  const data = await readResponse<{ task: TaskMasterTask }>(response);
  return data.task;
}

function launchStorageKey(project: Project, task: TaskMasterTask): string {
  return `taskmaster-launch:${projectId(project)}:${String(task.id)}`;
}

function createLaunchKey(): string {
  return `launch:${crypto.randomUUID()}`;
}

async function waitForLinkedLaunch(
  project: Project,
  attemptId: string,
  timeoutMs = 30_000,
): Promise<LaunchAttempt> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await authenticatedFetch(
      `/api/taskmaster/workflow/${encodeURIComponent(projectId(project))}/launches/${encodeURIComponent(attemptId)}`,
    );
    const data = await readResponse<{ attempt: LaunchAttempt }>(response);
    if (data.attempt.status === 'linked') {
      return data.attempt;
    }
    if (['failed', 'expired'].includes(data.attempt.status)) {
      throw new Error(data.attempt.failure || 'The implementation launch failed before delivery was accepted.');
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  throw new Error('The launch is still being reconciled. Try Start again to resume its status check.');
}

type StartTaskImplementationArgs = {
  project: Project;
  task: TaskMasterTask;
  selection?: ProviderSelection;
} & TaskWorkflowCallbacks;

async function runTaskImplementation(args: StartTaskImplementationArgs): Promise<{ attemptId: string; sessionId: string }> {
  const selection = args.selection ?? await readSettingsProviderSelection();
  const storageKey = launchStorageKey(args.project, args.task);
  const idempotencyKey = localStorage.getItem(storageKey) || createLaunchKey();
  localStorage.setItem(storageKey, idempotencyKey);
  let attempt: LaunchAttempt | null = null;
  try {
    const beginResponse = await authenticatedFetch(
      `/api/taskmaster/workflow/${encodeURIComponent(projectId(args.project))}/tasks/${encodeURIComponent(String(args.task.id))}/launch`,
      {
        method: 'POST',
        body: JSON.stringify({
          provider: selection.provider,
          providerProfileId: selection.providerProfileId,
          idempotencyKey,
        }),
      },
    );
    const begun = await readResponse<{ attempt: LaunchAttempt }>(beginResponse);
    attempt = begun.attempt;

    if (!attempt.sessionId && attempt.status === 'reserved') {
      const sessionId = await allocateSession(args.project, selection);
      const bindResponse = await authenticatedFetch(
        `/api/taskmaster/workflow/${encodeURIComponent(projectId(args.project))}/launches/${encodeURIComponent(attempt.id)}/bind`,
        {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        },
      );
      const bound = await readResponse<{ attempt: LaunchAttempt }>(bindResponse);
      attempt = bound.attempt;
    }

    if (!attempt.sessionId) {
      throw new Error('The launch attempt has no fresh session.');
    }
    if (attempt.status === 'bound') {
      args.onSessionProcessing?.(attempt.sessionId, { statusText: 'Starting approved task…', canInterrupt: true });
      args.sendMessage({
        type: 'chat.send',
        sessionId: attempt.sessionId,
        content: attempt.content,
        workflow: {
          kind: 'implementation',
          id: attempt.id,
          contentHash: attempt.contentHash,
        },
        options: { model: selection.model },
      });
    }

    const linked = await waitForLinkedLaunch(args.project, attempt.id);
    if (!linked.sessionId) {
      throw new Error('The linked launch has no implementation session.');
    }
    localStorage.removeItem(storageKey);
    const context: SessionEstablishedContext = {
      provider: selection.provider,
      project: args.project,
      summary: `Task ${String(args.task.id)}: ${args.task.title}`,
    };
    args.onSessionEstablished?.(linked.sessionId, context);
    args.onNavigateToSession?.(linked.sessionId);
    return { attemptId: linked.id, sessionId: linked.sessionId };
  } catch (error) {
    if (attempt && ['failed', 'expired'].includes(attempt.status)) {
      localStorage.removeItem(storageKey);
    }
    throw error;
  }
}

export function startTaskImplementation(
  args: StartTaskImplementationArgs,
): Promise<{ attemptId: string; sessionId: string }> {
  return runSingleFlight(launchStorageKey(args.project, args.task), () => runTaskImplementation(args));
}
