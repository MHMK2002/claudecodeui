/**
 * ScheduledRunsContext — owns the user's schedule list and run history.
 * Subscribes to the WebSocket for `scheduled_runs.changed` and
 * `scheduled_run.finished` events so the UI never goes stale.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../utils/api';
import { useWebSocket } from './WebSocketContext';
import type {
  CreateScheduledRunInput,
  ScheduledRun,
  ScheduledRunHistory,
  UpdateScheduledRunInput,
} from '../types/scheduledRuns';

type ApiError = { error: string };

type UpdateScheduledRunInputForWire = UpdateScheduledRunInput;

interface ScheduledRunsContextValue {
  schedules: ScheduledRun[];
  loadingList: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  historiesBySchedule: Record<number, ScheduledRunHistory[]>;
  refresh: () => Promise<void>;
  loadHistory: (scheduleId: number, options?: { force?: boolean }) => Promise<void>;
  create: (input: CreateScheduledRunInput) => Promise<ScheduledRun>;
  update: (id: number, patch: UpdateScheduledRunInputForWire) => Promise<ScheduledRun>;
  stageRemove: (id: number) => ScheduledRun | null;
  undoRemove: (id: number) => boolean;
  setEnabled: (id: number, enabled: boolean) => Promise<ScheduledRun>;
  runNow: (id: number) => Promise<{ runId: number }>;
}

const ScheduledRunsContext = createContext<ScheduledRunsContextValue | null>(null);

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as ApiError | { message?: string };
    if (body && typeof body === 'object') {
      if ('error' in body && typeof body.error === 'string') return body.error;
      if ('message' in body && typeof body.message === 'string') return body.message;
    }
  } catch {
    // Ignore parse errors and return the fallback.
  }
  return fallback;
}

export function ScheduledRunsProvider({ children }: { children: React.ReactNode }) {
  const { subscribe } = useWebSocket();
  const [schedules, setSchedules] = useState<ScheduledRun[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [historiesBySchedule, setHistoriesBySchedule] = useState<Record<number, ScheduledRunHistory[]>>({});
  const loadingHistoryRef = useRef<Set<number>>(new Set());
  const pendingRemovalsRef = useRef(new Map<number, { schedule: ScheduledRun; timer: number }>());

  const refresh = useCallback(async () => {
    setLoadingList(true);
    try {
      const response = await api.scheduledRuns.list();
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load schedules.'));
      }
      const body = (await response.json()) as { schedules: ScheduledRun[] };
      const pendingIds = new Set(pendingRemovalsRef.current.keys());
      setSchedules((body.schedules ?? []).filter((schedule) => !pendingIds.has(schedule.id)));
      setLastFetchedAt(Date.now());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadHistory = useCallback(async (scheduleId: number, options?: { force?: boolean }) => {
    if (!options?.force && historiesBySchedule[scheduleId]) return;
    if (loadingHistoryRef.current.has(scheduleId)) return;
    loadingHistoryRef.current.add(scheduleId);
    try {
      const response = await api.scheduledRuns.history(scheduleId, 50);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load history.'));
      }
      const body = (await response.json()) as { history: ScheduledRunHistory[] };
      setHistoriesBySchedule((prev) => ({ ...prev, [scheduleId]: body.history ?? [] }));
    } catch (cause) {
      // Surface as a console error; the panel renders its own empty/error state.
      console.error('[ScheduledRuns] Failed to load history:', cause);
    } finally {
      loadingHistoryRef.current.delete(scheduleId);
    }
  }, [historiesBySchedule]);

  const create = useCallback(async (input: CreateScheduledRunInput): Promise<ScheduledRun> => {
    const response = await api.scheduledRuns.create(input);
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Failed to create schedule.'));
    }
    const body = (await response.json()) as { schedule: ScheduledRun };
    await refresh();
    return body.schedule;
  }, [refresh]);

  const update = useCallback(async (id: number, patch: UpdateScheduledRunInputForWire) => {
    const response = await api.scheduledRuns.update(id, patch);
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Failed to update schedule.'));
    }
    const body = (await response.json()) as { schedule: ScheduledRun };
    await refresh();
    return body.schedule;
  }, [refresh]);

  const stageRemove = useCallback((id: number): ScheduledRun | null => {
    const schedule = schedules.find((candidate) => candidate.id === id) ?? null;
    if (!schedule || pendingRemovalsRef.current.has(id)) return schedule;
    const timer = window.setTimeout(() => {
      const pending = pendingRemovalsRef.current.get(id);
      if (!pending) return;
      pendingRemovalsRef.current.delete(id);
      void (async () => {
        const response = await api.scheduledRuns.remove(id);
        if (!response.ok) {
          const message = await readErrorMessage(response, 'Failed to delete schedule.');
          setError(message);
          setSchedules((current) => current.some((candidate) => candidate.id === id)
            ? current
            : [...current, pending.schedule]);
          return;
        }
        setHistoriesBySchedule((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      })();
    }, 8_000);
    pendingRemovalsRef.current.set(id, { schedule, timer });
    setSchedules((current) => current.filter((candidate) => candidate.id !== id));
    return schedule;
  }, [schedules]);

  const undoRemove = useCallback((id: number): boolean => {
    const pending = pendingRemovalsRef.current.get(id);
    if (!pending) return false;
    window.clearTimeout(pending.timer);
    pendingRemovalsRef.current.delete(id);
    setSchedules((current) => current.some((candidate) => candidate.id === id)
      ? current
      : [...current, pending.schedule]);
    return true;
  }, []);

  useEffect(() => () => {
    pendingRemovalsRef.current.forEach(({ timer }) => window.clearTimeout(timer));
    pendingRemovalsRef.current.clear();
  }, []);

  const setEnabled = useCallback(async (id: number, enabled: boolean) => {
    const response = enabled
      ? await api.scheduledRuns.enable(id)
      : await api.scheduledRuns.disable(id);
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Failed to toggle schedule.'));
    }
    const body = (await response.json()) as { schedule: ScheduledRun };
    await refresh();
    return body.schedule;
  }, [refresh]);

  const runNow = useCallback(async (id: number) => {
    const response = await api.scheduledRuns.runNow(id);
    if (!response.ok) {
      const message = await readErrorMessage(response, 'Failed to trigger run.');
      const error = new Error(message);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    const body = (await response.json()) as { runId: number };
    await refresh();
    return body;
  }, [refresh]);

  // WebSocket subscription — refresh list on any change and reload history for
  // the affected schedule when a run finishes.
  useEffect(() => {
    const unsubscribe = subscribe((message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const event = message as { kind?: string; scheduleId?: number };
      if (event.kind === 'scheduled_runs.changed') {
        void refresh();
      } else if (event.kind === 'scheduled_run.finished' && typeof event.scheduleId === 'number') {
        void refresh();
        void loadHistory(event.scheduleId, { force: true });
      }
    });
    return unsubscribe;
  }, [subscribe, refresh, loadHistory]);

  // Initial fetch.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<ScheduledRunsContextValue>(
    () => ({
      schedules,
      loadingList,
      error,
      lastFetchedAt,
      historiesBySchedule,
      refresh,
      loadHistory,
      create,
      update,
      stageRemove,
      undoRemove,
      setEnabled,
      runNow,
    }),
    [
      schedules,
      loadingList,
      error,
      lastFetchedAt,
      historiesBySchedule,
      refresh,
      loadHistory,
      create,
      update,
      stageRemove,
      undoRemove,
      setEnabled,
      runNow,
    ],
  );

  return <ScheduledRunsContext.Provider value={value}>{children}</ScheduledRunsContext.Provider>;
}

export function useScheduledRuns(): ScheduledRunsContextValue {
  const ctx = useContext(ScheduledRunsContext);
  if (!ctx) {
    throw new Error('useScheduledRuns must be used inside a ScheduledRunsProvider.');
  }
  return ctx;
}
