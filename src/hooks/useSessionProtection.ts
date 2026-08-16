import { useCallback, useState } from 'react';

export interface SessionActivity {
  /** Provider-supplied status line; null renders the default activity label. */
  statusText: string | null;
  canInterrupt: boolean;
  /**
   * When this request was first marked as processing (client clock). Drives
   * the elapsed-time display and the stale `chat_subscribed` idle-ack guard.
   */
  startedAt: number;
}

export type SessionActivityMap = ReadonlyMap<string, SessionActivity>;

export type SessionActivitySnapshot = {
  sessionId: string;
  statusText?: string | null;
  canInterrupt?: boolean;
  startedAt?: number;
};

export type MarkSessionProcessing = (
  sessionId?: string | null,
  activity?: { statusText?: string | null; canInterrupt?: boolean },
) => void;

export type MarkSessionIdle = (
  sessionId?: string | null,
  opts?: { ifStartedBefore?: number },
) => void;

export type SyncProcessingSessions = (
  sessions: readonly SessionActivitySnapshot[],
) => void;

const LOCAL_ACTIVITY_GRACE_MS = 10_000;

const sessionActivityMapsMatch = (
  left: ReadonlyMap<string, SessionActivity>,
  right: ReadonlyMap<string, SessionActivity>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }

  for (const [sessionId, leftActivity] of left) {
    const rightActivity = right.get(sessionId);
    if (
      !rightActivity
      || leftActivity.statusText !== rightActivity.statusText
      || leftActivity.canInterrupt !== rightActivity.canInterrupt
      || leftActivity.startedAt !== rightActivity.startedAt
    ) {
      return false;
    }
  }

  return true;
};

/** Applies running/status/stream evidence while retaining the original start time. */
export function applySessionProcessing(
  previous: ReadonlyMap<string, SessionActivity>,
  sessionId: string,
  activity: { statusText?: string | null; canInterrupt?: boolean } = {},
  now = Date.now(),
): Map<string, SessionActivity> {
  const existing = previous.get(sessionId);
  const next: SessionActivity = {
    statusText: activity.statusText !== undefined ? activity.statusText : existing?.statusText ?? null,
    canInterrupt: activity.canInterrupt ?? existing?.canInterrupt ?? true,
    startedAt: existing?.startedAt ?? now,
  };
  if (
    existing
    && existing.statusText === next.statusText
    && existing.canInterrupt === next.canInterrupt
  ) {
    return previous as Map<string, SessionActivity>;
  }
  const updated = new Map(previous);
  updated.set(sessionId, next);
  return updated;
}

/** Applies complete/abort/authoritative-idle evidence with stale-ack protection. */
export function applySessionIdle(
  previous: ReadonlyMap<string, SessionActivity>,
  sessionId: string,
  options: { ifStartedBefore?: number } = {},
): Map<string, SessionActivity> {
  const existing = previous.get(sessionId);
  if (!existing) return previous as Map<string, SessionActivity>;
  if (options.ifStartedBefore !== undefined && existing.startedAt >= options.ifStartedBefore) {
    return previous as Map<string, SessionActivity>;
  }
  const updated = new Map(previous);
  updated.delete(sessionId);
  return updated;
}

/** Resolves only the viewed session so switching never leaks another run's Stop state. */
export function getViewedSessionActivity(
  activities: ReadonlyMap<string, SessionActivity> | undefined,
  sessionId: string | null,
): SessionActivity | null {
  return sessionId ? activities?.get(sessionId) ?? null : null;
}

/**
 * Single source of truth for which sessions are actively processing a
 * request. Everything the chat UI shows (activity indicator, abort
 * availability, status text) is derived from this map; terminal events
 * (`complete`, abort, an authoritative idle subscribe ack) delete the entry
 * atomically. Session ids are always concrete (allocated before the first
 * send), so entries are keyed by real session ids only.
 */
export function useSessionProtection() {
  const [processingSessions, setProcessingSessions] = useState<Map<string, SessionActivity>>(
    new Map(),
  );

  const markSessionProcessing = useCallback<MarkSessionProcessing>((sessionId, activity) => {
    if (!sessionId) {
      return;
    }

    setProcessingSessions((prev) => {
      return applySessionProcessing(prev, sessionId, activity);
    });
  }, []);

  const markSessionIdle = useCallback<MarkSessionIdle>((sessionId, opts) => {
    if (!sessionId) {
      return;
    }

    setProcessingSessions((prev) => {
      return applySessionIdle(prev, sessionId, opts);
    });
  }, []);

  const syncProcessingSessions = useCallback<SyncProcessingSessions>((sessions) => {
    const now = Date.now();

    setProcessingSessions((prev) => {
      const incoming = new Map<string, SessionActivitySnapshot>();
      for (const session of sessions) {
        if (!session.sessionId) {
          continue;
        }
        incoming.set(session.sessionId, session);
      }

      const updated = new Map<string, SessionActivity>();

      for (const [sessionId, snapshot] of incoming) {
        const existing = prev.get(sessionId);
        const snapshotStartedAt =
          typeof snapshot.startedAt === 'number' && Number.isFinite(snapshot.startedAt) && snapshot.startedAt > 0
            ? snapshot.startedAt
            : undefined;

        updated.set(sessionId, {
          statusText:
            snapshot.statusText !== undefined ? snapshot.statusText : existing?.statusText ?? null,
          canInterrupt: snapshot.canInterrupt ?? existing?.canInterrupt ?? true,
          startedAt: snapshotStartedAt ?? existing?.startedAt ?? now,
        });
      }

      for (const [sessionId, activity] of prev) {
        if (!incoming.has(sessionId) && now - activity.startedAt < LOCAL_ACTIVITY_GRACE_MS) {
          updated.set(sessionId, activity);
        }
      }

      return sessionActivityMapsMatch(prev, updated) ? prev : updated;
    });
  }, []);

  return {
    processingSessions,
    markSessionProcessing,
    markSessionIdle,
    syncProcessingSessions,
  };
}
