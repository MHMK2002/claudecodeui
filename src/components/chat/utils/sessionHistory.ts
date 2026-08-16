import type {
  SessionHistoryResult,
  SessionHistorySnapshot,
  SessionSlot,
} from '../../../stores/useSessionStore';

const SUPERSEDED_HISTORY_ERROR = 'Conversation history changed while it was loading. Try again.';
const INCOMPLETE_HISTORY_ERROR = 'Could not load the complete conversation. Try again.';

export function isCompleteSessionHistorySnapshot(
  snapshot: Pick<SessionHistorySnapshot, 'hasMore' | 'serverMessages' | 'total'>,
): boolean {
  return !snapshot.hasMore && snapshot.serverMessages.length === snapshot.total;
}

/** Prevents a delayed page from mutating pagination for a newer Chat view. */
export function ownsSessionHistoryView(
  request: { sessionId: string; projectId: string; generation: number },
  current: { sessionId: string | null; projectId: string | null; generation: number },
): boolean {
  return request.generation === current.generation
    && request.sessionId === current.sessionId
    && request.projectId === current.projectId;
}

export type LoadAllHistoryCompletion = {
  complete: boolean;
  showOverlay: boolean;
  total: number | null;
  error: string | null;
};

/** Maps a full-history request into the local pagination/overlay terminal state. */
export function resolveLoadAllHistoryCompletion(
  result: SessionHistoryResult,
): LoadAllHistoryCompletion {
  if (!result.ok) {
    return {
      complete: false,
      showOverlay: false,
      total: null,
      error: result.error,
    };
  }
  if (!result.applied || result.superseded) {
    return {
      complete: false,
      showOverlay: false,
      total: null,
      error: SUPERSEDED_HISTORY_ERROR,
    };
  }
  if (!isCompleteSessionHistorySnapshot(result.snapshot)) {
    return {
      complete: false,
      showOverlay: false,
      total: null,
      error: INCOMPLETE_HISTORY_ERROR,
    };
  }
  return {
    complete: true,
    showOverlay: true,
    total: result.snapshot.total,
    error: null,
  };
}

export type LoadOlderHistoryCompletion =
  | { applied: false; error: string | null }
  | {
    applied: true;
    addedCount: number;
    hasMore: boolean;
    total: number;
    allLoaded: boolean;
    error: null;
  };

/** Keeps pagination and scroll changes tied to the page that actually applied. */
export function resolveLoadOlderHistoryCompletion(
  result: SessionHistoryResult,
): LoadOlderHistoryCompletion {
  if (!result.ok) {
    return {
      applied: false,
      error: result.applied ? result.error : null,
    };
  }
  if (!result.applied || result.superseded) {
    return { applied: false, error: null };
  }
  return {
    applied: true,
    addedCount: result.receivedCount,
    hasMore: result.snapshot.hasMore,
    total: result.snapshot.total,
    allLoaded: isCompleteSessionHistorySnapshot(result.snapshot),
    error: null,
  };
}

export type SessionPaginationSnapshot = {
  hasMore: boolean;
  total: number;
  allLoaded: boolean;
};

/** Synchronizes Chat's local pagination after another consumer hydrates the shared slot. */
export function resolveSessionPaginationSnapshot(slot: SessionSlot): SessionPaginationSnapshot {
  return {
    hasMore: slot.hasMore,
    total: slot.total,
    allLoaded: !slot.hasMore && slot.serverMessages.length === slot.total,
  };
}
