export type ChatRunControls = {
  mainAction: 'send' | 'stop';
  mainDisabled: boolean;
  queueVisible: boolean;
  stopExplanation: string | null;
};

export type ChatPrimaryAction =
  | 'send'
  | 'stop'
  | 'retry-catalog'
  | 'retry-history'
  | 'retry-connection';

/**
 * Resolves the one page-wide primary job shared by Chat history, catalog,
 * connection recovery, question panels, and the composer run control.
 */
export function resolveChatPrimaryAction(input: {
  isRunning: boolean;
  hasCatalogError: boolean;
  hasHistoryError: boolean;
  connectionUnavailable: boolean;
}): ChatPrimaryAction {
  if (input.isRunning) {
    if (input.connectionUnavailable) return 'retry-connection';
    return 'stop';
  }
  if (input.hasCatalogError) return 'retry-catalog';
  if (input.connectionUnavailable) return 'retry-connection';
  if (input.hasHistoryError) return 'retry-history';
  return 'send';
}

/** Resolves Chat's mutually-exclusive primary action and neutral queue affordance. */
export function resolveChatRunControls(input: {
  isRunning: boolean;
  canInterrupt: boolean;
  hasDraft: boolean;
  connectionAvailable?: boolean;
}): ChatRunControls {
  if (!input.isRunning) {
    return {
      mainAction: 'send',
      mainDisabled: false,
      queueVisible: false,
      stopExplanation: null,
    };
  }
  return {
    mainAction: 'stop',
    mainDisabled: !input.canInterrupt || input.connectionAvailable === false,
    queueVisible: input.hasDraft,
    stopExplanation: input.connectionAvailable === false
      ? 'Reconnect Chat before stopping this run.'
      : input.canInterrupt
        ? null
        : 'This provider cannot be interrupted during the current step.',
  };
}

/** Prevents a failed task action from being retried against a newly selected project. */
export function canRetryTaskStartForProject(
  originatingProjectId: string,
  currentProjectId: string | null | undefined,
): boolean {
  return Boolean(currentProjectId && originatingProjectId === currentProjectId);
}

export type TaskStartView = {
  projectId: string | null;
  sessionId: string | null;
};

/** Guards async task-start terminal state against a newer attempt or view. */
export function isTaskStartAttemptCurrent(
  attemptId: number,
  currentAttemptId: number,
  origin: TaskStartView,
  current: TaskStartView,
): boolean {
  return attemptId === currentAttemptId
    && origin.projectId === current.projectId
    && origin.sessionId === current.sessionId;
}

/** Running inference always wins the primary visual over concurrent voice transcription. */
export function resolveChatPrimaryVisual(
  isRunning: boolean,
  isTranscribing: boolean,
): 'stop' | 'transcribing' | 'send' {
  if (isRunning) return 'stop';
  return isTranscribing ? 'transcribing' : 'send';
}
