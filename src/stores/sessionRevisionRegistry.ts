export type SessionRevisionRegistry = ReturnType<typeof createSessionRevisionRegistry>;

/**
 * Creates a session-keyed external-store signal. The lifted session store uses
 * this to wake Chat body and header consumers without changing the store object
 * identity or retriggering history effects on every realtime message.
 */
export function createSessionRevisionRegistry() {
  const revisions = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();

  const getSnapshot = (sessionId: string | null): number => (
    sessionId ? revisions.get(sessionId) ?? 0 : 0
  );

  const subscribe = (sessionId: string | null, listener: () => void): (() => void) => {
    if (!sessionId) return () => undefined;
    const sessionListeners = listeners.get(sessionId) ?? new Set<() => void>();
    sessionListeners.add(listener);
    listeners.set(sessionId, sessionListeners);
    return () => {
      sessionListeners.delete(listener);
      if (sessionListeners.size === 0) listeners.delete(sessionId);
    };
  };

  const notify = (sessionId: string): void => {
    revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1);
    listeners.get(sessionId)?.forEach((listener) => listener());
  };

  return { getSnapshot, subscribe, notify };
}
