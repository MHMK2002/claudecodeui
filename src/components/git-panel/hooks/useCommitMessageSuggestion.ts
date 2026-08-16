import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { LLMProvider } from '../../../types/app';
import {
  readStoredProviderSelectionPreferences,
} from '../../../shared/providerSelectionCatalog';
import {
  loadProviderSelectionCatalog,
  resolveValidSelection,
} from '../../../shared/hooks/useProviderSelectionCatalog';
import { authenticatedFetch } from '../../../utils/api';
import type {
  CommitMessageDraftCacheEntry,
  CommitMessageGenerationError,
  CommitMessageGenerationFailureResponse,
  CommitMessageGenerationResponse,
  CommitMessageSuggestionController,
  CommitMessageSuggestionState,
} from '../types/types';

const CLIENT_GENERATION_TIMEOUT_MS = 65_000;
const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};
const commitMessageDraftCache = new Map<string, CommitMessageDraftCacheEntry>();

type SuggestionEvent =
  | {
    type: 'request-started';
    requestId: number;
    projectId: string;
    stagedKey: string;
    mode: 'generate' | 'update';
  }
  | { type: 'provider-resolved'; requestId: number }
  | {
    type: 'request-succeeded';
    requestId: number;
    projectId: string;
    stagedKey: string;
    response: CommitMessageGenerationResponse;
  }
  | { type: 'request-failed'; requestId: number; error: CommitMessageGenerationError }
  | { type: 'request-cancelled'; requestId: number }
  | { type: 'draft-changed'; message: string }
  | { type: 'staged-key-changed'; stagedKey: string }
  | { type: 'use-suggestion' }
  | { type: 'dismiss-suggestion'; stagedKey: string }
  | { type: 'keep-current-message' }
  | { type: 'commit-conflict' }
  | { type: 'commit-succeeded' };

function emptyRequestFields() {
  return {
    requestId: null,
    requestProjectId: null,
    requestStagedKey: null,
    requestDraftRevision: null,
    requestStartedMessage: null,
  } as const;
}

/** Creates a reducer state from a manual string or the project cache. */
export function createCommitMessageSuggestionState(
  initial: string | CommitMessageDraftCacheEntry = '',
): CommitMessageSuggestionState {
  const cache = typeof initial === 'string'
    ? null
    : initial;
  const message = typeof initial === 'string' ? initial : initial.message;
  const provenance = cache?.provenance ?? 'manual';
  const hasGeneratedSnapshot = provenance === 'generated'
    && Boolean(cache?.snapshotId)
    && Boolean(cache?.generatedStagedKey);
  const generatedSnapshotIsStale = hasGeneratedSnapshot && cache?.status === 'stale';
  return {
    status: generatedSnapshotIsStale
      ? 'stale'
      : hasGeneratedSnapshot
        ? 'applied'
        : message.trim()
          ? 'manual'
          : 'idle',
    message,
    draftRevision: cache?.draftRevision ?? 0,
    provenance,
    snapshotId: cache?.snapshotId ?? null,
    generatedMessage: cache?.generatedMessage ?? null,
    generatedStagedKey: cache?.generatedStagedKey ?? null,
    selection: cache?.selection ?? null,
    analysis: cache?.analysis ?? null,
    candidate: null,
    error: null,
    ...emptyRequestFields(),
    requestMode: null,
  };
}

function responseMatchesActiveRequest(
  state: CommitMessageSuggestionState,
  event: Extract<SuggestionEvent, { type: 'request-succeeded' }>,
): boolean {
  return state.requestId === event.requestId
    && state.requestProjectId === event.projectId
    && state.requestStagedKey === event.stagedKey;
}

/** Explicit, pure commit-message suggestion state machine used by the hook and contract tests. */
export function commitMessageSuggestionReducer(
  state: CommitMessageSuggestionState,
  event: SuggestionEvent,
): CommitMessageSuggestionState {
  switch (event.type) {
    case 'request-started':
      return {
        ...state,
        status: 'checking-provider',
        candidate: null,
        error: null,
        requestId: event.requestId,
        requestProjectId: event.projectId,
        requestStagedKey: event.stagedKey,
        requestDraftRevision: state.draftRevision,
        requestStartedMessage: state.message,
        requestMode: event.mode,
      };
    case 'provider-resolved':
      return state.requestId === event.requestId
        ? { ...state, status: 'generating' }
        : state;
    case 'request-succeeded': {
      if (!responseMatchesActiveRequest(state, event)) return state;
      const unchangedDraft = state.draftRevision === state.requestDraftRevision
        && state.message === state.requestStartedMessage;
      const canApplyEmptyDraft = state.requestMode === 'generate'
        && unchangedDraft
        && state.message.length === 0;
      const canReplaceUneditedGeneratedDraft = state.requestMode === 'update'
        && unchangedDraft
        && state.provenance === 'generated'
        && state.generatedMessage !== null
        && state.message === state.generatedMessage;
      const candidate = {
        message: event.response.message,
        snapshotId: event.response.snapshotId,
        stagedKey: event.stagedKey,
        selection: event.response.selection,
        analysis: event.response.analysis,
      };
      if (canApplyEmptyDraft || canReplaceUneditedGeneratedDraft) {
        return {
          ...state,
          status: 'applied',
          message: event.response.message,
          draftRevision: state.draftRevision + 1,
          provenance: 'generated',
          snapshotId: event.response.snapshotId,
          generatedMessage: event.response.message,
          generatedStagedKey: event.stagedKey,
          selection: event.response.selection,
          analysis: event.response.analysis,
          candidate: null,
          error: null,
          ...emptyRequestFields(),
        };
      }
      return {
        ...state,
        status: 'suggestion',
        candidate,
        error: null,
        ...emptyRequestFields(),
      };
    }
    case 'request-failed':
      if (state.requestId !== event.requestId) return state;
      return {
        ...state,
        status: 'error',
        error: event.error,
        candidate: null,
        ...emptyRequestFields(),
      };
    case 'request-cancelled':
      if (state.requestId !== event.requestId) return state;
      return {
        ...state,
        status: 'cancelled',
        candidate: null,
        error: null,
        ...emptyRequestFields(),
      };
    case 'draft-changed': {
      const generatedDraft = state.provenance === 'generated' && Boolean(state.snapshotId);
      const preserveStatus = ['checking-provider', 'generating', 'suggestion', 'stale'].includes(state.status);
      return {
        ...state,
        message: event.message,
        draftRevision: state.draftRevision + 1,
        provenance: generatedDraft ? 'generated' : 'manual',
        status: preserveStatus
          ? state.status
          : generatedDraft
            ? 'applied'
            : event.message.trim()
              ? 'manual'
              : 'idle',
      };
    }
    case 'staged-key-changed': {
      const generatedIsStale = state.provenance === 'generated'
        && Boolean(state.snapshotId)
        && (state.status === 'stale' || state.generatedStagedKey !== event.stagedKey);
      const candidateIsStale = state.candidate && state.candidate.stagedKey !== event.stagedKey;
      const generatedMatchesCurrentStage = state.provenance === 'generated'
        && Boolean(state.snapshotId)
        && state.generatedStagedKey === event.stagedKey;
      if (
        !generatedIsStale
        && !candidateIsStale
        && (state.requestStagedKey === event.stagedKey || generatedMatchesCurrentStage)
      ) {
        return state;
      }
      return {
        ...state,
        status: generatedIsStale ? 'stale' : state.message.trim() ? 'manual' : 'idle',
        candidate: candidateIsStale ? null : state.candidate,
        error: null,
        ...emptyRequestFields(),
      };
    }
    case 'use-suggestion':
      if (!state.candidate) return state;
      return {
        ...state,
        status: 'applied',
        message: state.candidate.message,
        draftRevision: state.draftRevision + 1,
        provenance: 'generated',
        snapshotId: state.candidate.snapshotId,
        generatedMessage: state.candidate.message,
        generatedStagedKey: state.candidate.stagedKey,
        selection: state.candidate.selection,
        analysis: state.candidate.analysis,
        candidate: null,
        error: null,
      };
    case 'dismiss-suggestion': {
      const generatedIsStale = state.provenance === 'generated'
        && Boolean(state.snapshotId)
        && state.generatedStagedKey !== event.stagedKey;
      return {
        ...state,
        status: generatedIsStale
          ? 'stale'
          : state.provenance === 'generated'
            ? 'applied'
            : state.message.trim()
              ? 'manual'
              : 'idle',
        candidate: null,
        error: null,
      };
    }
    case 'keep-current-message':
      return {
        ...state,
        status: state.message.trim() ? 'manual' : 'idle',
        provenance: 'manual',
        snapshotId: null,
        generatedMessage: null,
        generatedStagedKey: null,
        selection: null,
        analysis: null,
        candidate: null,
        error: null,
      };
    case 'commit-conflict':
      return state.provenance === 'generated' && state.snapshotId
        ? { ...state, status: 'stale', candidate: null, error: null }
        : state;
    case 'commit-succeeded':
      return createCommitMessageSuggestionState();
    default:
      return state;
  }
}

function stagedFileKey(files: string[]): string {
  return [...files].sort((left, right) => left.localeCompare(right)).join('\0');
}

function isJsonContentType(value: string | null): boolean {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const GENERATION_ERROR_CODES = new Set([
  'INVALID_GENERATION_REQUEST',
  'TOO_MANY_STAGED_FILES',
  'NO_STAGED_CHANGES',
  'STAGED_CHANGES_CHANGED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_PROFILE_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'PROVIDER_UNSUPPORTED_FOR_GENERATION',
  'GENERATION_FAILED',
  'INVALID_GENERATED_MESSAGE',
  'GENERATION_TIMEOUT',
]);

function fallbackGenerationError(message: string): CommitMessageGenerationError {
  return {
    code: 'GENERATION_FAILED',
    error: 'Commit-message generation failed.',
    details: message,
    action: 'RETRY',
  };
}

async function decodeGenerationResponse(response: Response): Promise<CommitMessageGenerationResponse> {
  if (!isJsonContentType(response.headers.get('content-type'))) {
    throw fallbackGenerationError(
      response.ok
        ? 'The server returned an unsupported response.'
        : `The generation request failed (${response.status}).`,
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw fallbackGenerationError('The server returned invalid JSON.');
  }
  const payload = asRecord(value);
  if (!response.ok || payload?.success === false) {
    const failure = (payload ?? {}) as CommitMessageGenerationFailureResponse;
    const code: CommitMessageGenerationError['code'] = GENERATION_ERROR_CODES.has(String(failure.code))
      ? failure.code as CommitMessageGenerationError['code']
      : 'GENERATION_FAILED';
    throw {
      code,
      error: typeof failure.error === 'string' && failure.error.trim()
        ? failure.error
        : 'Commit-message generation failed.',
      details: typeof failure.details === 'string' && failure.details.trim()
        ? failure.details
        : 'Try generating the suggestion again.',
      action: failure.action === 'OPEN_AGENT_SETTINGS' || failure.action === 'REVIEW_STAGED_CHANGES'
        ? failure.action
        : 'RETRY',
    } satisfies CommitMessageGenerationError;
  }
  const selection = asRecord(payload?.selection);
  const analysis = asRecord(payload?.analysis);
  if (
    payload?.success !== true
    || typeof payload.message !== 'string'
    || !payload.message.trim()
    || typeof payload.snapshotId !== 'string'
    || !/^[a-f0-9]{64}$/.test(payload.snapshotId)
    || !selection
    || !['claude', 'codex', 'cursor', 'opencode'].includes(String(selection.provider))
    || !(selection.providerProfileId === null || Number.isInteger(selection.providerProfileId))
    || typeof selection.model !== 'string'
    || !selection.model.trim()
    || !analysis
    || !Number.isInteger(analysis.totalStagedFiles)
    || !Number.isInteger(analysis.sampledFiles)
    || !Number.isInteger(analysis.recentSubjects)
    || typeof analysis.truncated !== 'boolean'
  ) {
    throw fallbackGenerationError('The server returned an invalid generation response.');
  }
  return value as CommitMessageGenerationResponse;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Lets one Git consumer stop waiting without cancelling the shared catalog fetch. */
export function raceWithAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      cleanup();
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

type UseCommitMessageSuggestionOptions = {
  projectId: string;
  stagedFiles: string[];
  hasPendingStageOperations: boolean;
};

/** Owns generation request identity, cancellation, provenance, and the project draft cache. */
export function useCommitMessageSuggestion({
  projectId,
  stagedFiles,
  hasPendingStageOperations,
}: UseCommitMessageSuggestionOptions): CommitMessageSuggestionController {
  const [state, dispatch] = useReducer(
    commitMessageSuggestionReducer,
    commitMessageDraftCache.get(projectId) ?? '',
    createCommitMessageSuggestionState,
  );
  const stateRef = useRef(state);
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<{
    requestId: number;
    stagedKey: string;
    controller: AbortController;
    timedOut: boolean;
  } | null>(null);
  const currentStagedKey = useMemo(() => stagedFileKey(stagedFiles), [stagedFiles]);

  useEffect(() => {
    stateRef.current = state;
    if (state.message) {
      commitMessageDraftCache.set(projectId, {
        status: state.status,
        message: state.message,
        draftRevision: state.draftRevision,
        provenance: state.provenance,
        snapshotId: state.snapshotId,
        generatedMessage: state.generatedMessage,
        generatedStagedKey: state.generatedStagedKey,
        selection: state.selection,
        analysis: state.analysis,
      });
    } else {
      commitMessageDraftCache.delete(projectId);
    }
  }, [projectId, state]);

  useEffect(() => {
    const active = activeRequestRef.current;
    if (active && active.stagedKey !== currentStagedKey) {
      active.controller.abort();
      activeRequestRef.current = null;
    }
    dispatch({ type: 'staged-key-changed', stagedKey: currentStagedKey });
  }, [currentStagedKey]);

  useEffect(() => () => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
  }, [projectId]);

  const startRequest = useCallback((mode: 'generate' | 'update') => {
    if (stagedFiles.length === 0 || hasPendingStageOperations) return;
    activeRequestRef.current?.controller.abort();
    const requestId = ++requestSequenceRef.current;
    const controller = new AbortController();
    const active = { requestId, stagedKey: currentStagedKey, controller, timedOut: false };
    activeRequestRef.current = active;
    dispatch({
      type: 'request-started',
      requestId,
      projectId,
      stagedKey: currentStagedKey,
      mode,
    });
    const timeout = window.setTimeout(() => {
      const current = activeRequestRef.current;
      if (current?.requestId !== requestId) return;
      current.timedOut = true;
      current.controller.abort();
    }, CLIENT_GENERATION_TIMEOUT_MS);

    void (async () => {
      try {
        const catalog = await raceWithAbortSignal(
          loadProviderSelectionCatalog(),
          controller.signal,
        );
        if (activeRequestRef.current?.requestId !== requestId) return;
        const preferences = readStoredProviderSelectionPreferences();
        const resolved = resolveValidSelection(catalog, preferences.provider, {
          profileId: preferences.providerProfileId,
          model: preferences.model,
        });
        if (!resolved) {
          const entry = catalog.providers.find((candidate) => candidate.provider === preferences.provider);
          throw {
            code: 'PROVIDER_UNAVAILABLE',
            error: `${PROVIDER_LABELS[preferences.provider]} is unavailable.`,
            details: entry?.unavailableReason ?? 'Connect this provider in Agent Settings.',
            action: 'OPEN_AGENT_SETTINGS',
          } satisfies CommitMessageGenerationError;
        }
        dispatch({ type: 'provider-resolved', requestId });
        const response = await authenticatedFetch('/api/git/generate-commit-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project: projectId,
            files: [...stagedFiles].sort((left, right) => left.localeCompare(right)),
            selection: resolved,
          }),
          signal: controller.signal,
        });
        const result = await decodeGenerationResponse(response);
        if (
          result.selection.provider !== resolved.provider
          || result.selection.providerProfileId !== resolved.providerProfileId
          || result.selection.model !== resolved.model
        ) {
          throw fallbackGenerationError('The server used a different provider selection.');
        }
        dispatch({
          type: 'request-succeeded',
          requestId,
          projectId,
          stagedKey: currentStagedKey,
          response: result,
        });
      } catch (error) {
        const current = activeRequestRef.current;
        if (isAbortError(error) || controller.signal.aborted) {
          if (current?.requestId === requestId && current.timedOut) {
            dispatch({
              type: 'request-failed',
              requestId,
              error: {
                code: 'GENERATION_TIMEOUT',
                error: 'Commit-message generation timed out.',
                details: 'Try generating the suggestion again.',
                action: 'RETRY',
              },
            });
          }
          return;
        }
        const record = asRecord(error);
        const typedError = record
          && GENERATION_ERROR_CODES.has(String(record.code))
          && typeof record.error === 'string'
          && typeof record.details === 'string'
          ? record as CommitMessageGenerationError
          : fallbackGenerationError(error instanceof Error ? error.message : 'Try again.');
        dispatch({ type: 'request-failed', requestId, error: typedError });
      } finally {
        window.clearTimeout(timeout);
        if (activeRequestRef.current?.requestId === requestId) {
          activeRequestRef.current = null;
        }
      }
    })();
  }, [currentStagedKey, hasPendingStageOperations, projectId, stagedFiles]);

  const cancel = useCallback(() => {
    const active = activeRequestRef.current;
    if (!active) return;
    active.controller.abort();
    activeRequestRef.current = null;
    dispatch({ type: 'request-cancelled', requestId: active.requestId });
  }, []);

  const invalidateForCommit = useCallback(() => {
    const active = activeRequestRef.current;
    if (!active) return;
    active.controller.abort();
    activeRequestRef.current = null;
    dispatch({ type: 'request-cancelled', requestId: active.requestId });
  }, []);

  const selectedProvider = state.selection?.provider
    ?? readStoredProviderSelectionPreferences().provider;
  const isBusy = state.status === 'checking-provider' || state.status === 'generating';
  const generateDisabledReason = hasPendingStageOperations
    ? 'Wait for staging to finish.'
    : stagedFiles.length === 0
      ? 'Stage at least one file to generate a message.'
      : null;
  const generatedSnapshotIsStale = state.provenance === 'generated'
    && Boolean(state.snapshotId)
    && state.generatedStagedKey !== currentStagedKey;

  return {
    state,
    selectedProvider,
    selectedProviderLabel: PROVIDER_LABELS[selectedProvider],
    isBusy,
    canGenerate: !isBusy && !generateDisabledReason,
    generateDisabledReason,
    commitSnapshotId: generatedSnapshotIsStale ? null : state.snapshotId,
    isCommitBlockedByStaleSuggestion: generatedSnapshotIsStale || state.status === 'stale',
    setMessage(message) {
      dispatch({ type: 'draft-changed', message });
    },
    generate() {
      startRequest('generate');
    },
    cancel,
    retry() {
      startRequest(stateRef.current.requestMode ?? 'generate');
    },
    useSuggestion() {
      dispatch({ type: 'use-suggestion' });
    },
    dismissSuggestion() {
      dispatch({ type: 'dismiss-suggestion', stagedKey: currentStagedKey });
    },
    updateSuggestion() {
      startRequest('update');
    },
    keepCurrentMessage() {
      dispatch({ type: 'keep-current-message' });
    },
    invalidateForCommit,
    markCommitConflict() {
      dispatch({ type: 'commit-conflict' });
    },
    clearAfterCommit() {
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
      commitMessageDraftCache.delete(projectId);
      dispatch({ type: 'commit-succeeded' });
    },
  };
}
