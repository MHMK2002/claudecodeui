/**
 * ScheduledRunCard — one collapsible card per scheduled run.
 *
 * Header (always visible): chevron + title + status pill + overflow menu.
 * Summary row: cron in human form + provider chip + last-run meta.
 * Expanded section: prompt preview + recent history list.
 *
 * History is lazy-loaded via `loadHistory(scheduleId)` on first expand.
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, MoreHorizontal, Play, Pencil, Trash2, Pause, PlayCircle, Circle } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { describeCron } from '../../../utils/cron';
import { useScheduledRuns } from '../../../contexts/ScheduledRunsContext';
import type { ScheduledRun } from '../../../types/scheduledRuns';

type ScheduledRunCardProps = {
  schedule: ScheduledRun;
  onEdit: (schedule: ScheduledRun) => void;
};

const STATUS_PILL_CLASSES: Record<string, string> = {
  enabled: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
  disabled: 'border-border bg-muted text-muted-foreground',
  running: 'border-sky-500/40 bg-sky-500/10 text-sky-500',
};

const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return '—';
  const diffMs = target - Date.now();
  const absMin = Math.abs(diffMs) / 60_000;
  if (absMin < 1) return diffMs >= 0 ? 'in <1m' : 'just now';
  if (absMin < 60) return diffMs >= 0 ? `in ${Math.round(absMin)}m` : `${Math.round(absMin)}m ago`;
  const absHr = absMin / 60;
  if (absHr < 24) return diffMs >= 0 ? `in ${Math.round(absHr)}h` : `${Math.round(absHr)}h ago`;
  const absDay = absHr / 24;
  return diffMs >= 0 ? `in ${Math.round(absDay)}d` : `${Math.round(absDay)}d ago`;
}

function statusKey(schedule: ScheduledRun): 'enabled' | 'disabled' | 'running' {
  if (schedule.inFlightRunId !== null) return 'running';
  return schedule.isEnabled ? 'enabled' : 'disabled';
}

export function ScheduledRunCard({ schedule, onEdit }: ScheduledRunCardProps) {
  const { loadHistory, historiesBySchedule, setEnabled, remove, runNow } = useScheduledRuns();
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const history = historiesBySchedule[schedule.id] ?? [];

  useEffect(() => {
    if (expanded && !historiesBySchedule[schedule.id]) {
      void loadHistory(schedule.id);
    }
  }, [expanded, schedule.id, historiesBySchedule, loadHistory]);

  const handleToggleEnabled = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await setEnabled(schedule.id, !schedule.isEnabled);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }, [schedule.id, schedule.isEnabled, setEnabled]);

  const handleRunNow = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await runNow(schedule.id);
    } catch (cause) {
      setActionError(extractRunNowError(cause));
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  }, [schedule.id, runNow]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setMenuOpen(false);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await remove(schedule.id);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }, [confirmDelete, schedule.id, remove]);

  const pill = statusKey(schedule);
  const description = describeCron(schedule.cronExpression, schedule.timezone);

  return (
    <article
      className={cn(
        'rounded-lg border border-border/60 bg-background/40',
        'transition-colors hover:border-border',
      )}
    >
      <header
        className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5"
        onClick={() => setExpanded((previous) => !previous)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              !expanded && '-rotate-90',
            )}
          />
          <span className="truncate text-sm font-medium text-foreground">{schedule.title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              STATUS_PILL_CLASSES[pill],
            )}
          >
            {pill === 'running' ? <Circle className="h-2 w-2 fill-current" /> : null}
            {pill}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((previous) => !previous);
            }}
            aria-label="Schedule actions"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </header>

      {menuOpen && (
        <div
          className="border-t border-border/60 bg-background/60 px-1 py-1"
          onClick={(event) => event.stopPropagation()}
        >
          <MenuItem
            icon={<Play className="h-3.5 w-3.5" />}
            label="Run now"
            onClick={handleRunNow}
            disabled={busy}
          />
          <MenuItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            label="Edit"
            onClick={() => {
              setMenuOpen(false);
              onEdit(schedule);
            }}
          />
          <MenuItem
            icon={schedule.isEnabled ? <Pause className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
            label={schedule.isEnabled ? 'Disable' : 'Enable'}
            onClick={handleToggleEnabled}
            disabled={busy}
          />
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Delete"
            destructive
            onClick={handleDelete}
            disabled={busy}
          />
        </div>
      )}

      <div className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{description}</span>
          <span className="shrink-0 rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">
            {PROVIDER_LABEL[schedule.provider] ?? schedule.provider}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span>
            Next: <span className="text-foreground">{relativeTime(schedule.nextRunAt)}</span>
          </span>
          <span>
            Last: <span className="text-foreground">{schedule.lastRunAt ? relativeTime(schedule.lastRunAt) : 'never'}</span>
          </span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/60 bg-muted/20 px-3 py-2.5 text-xs">
          <p className="mb-1 text-muted-foreground">Prompt</p>
          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background/50 p-2 font-mono text-[11px] text-foreground">
            {schedule.prompt}
          </pre>

          <div className="mt-3">
            <p className="mb-1 flex items-center justify-between text-muted-foreground">
              <span>Recent runs</span>
              {history.length === 0 && !busy ? <span className="text-[10px]">no history</span> : null}
            </p>
            {history.length === 0 ? null : (
              <ul className="flex flex-col gap-1">
                {history.slice(0, 8).map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-2 rounded border border-border/50 bg-background/40 px-2 py-1 text-[11px]"
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-block h-1.5 w-1.5 rounded-full',
                          row.status === 'succeeded' && 'bg-emerald-500',
                          row.status === 'failed' && 'bg-red-500',
                          row.status === 'running' && 'bg-sky-500',
                          row.status === 'skipped' && 'bg-muted-foreground',
                        )}
                      />
                      <span className="text-foreground">{row.status}</span>
                      <span className="text-muted-foreground">· {row.trigger}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {row.durationMs !== null ? `${Math.round(row.durationMs / 1000)}s` : '—'} · {relativeTime(row.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {confirmDelete && (
            <div className="mt-3 rounded border border-red-500/40 bg-red-500/5 p-2 text-[11px] text-red-500">
              Delete this schedule? This cannot be undone.
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded border border-border px-2 py-0.5 text-muted-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded bg-red-500 px-2 py-0.5 text-white disabled:opacity-50"
                  disabled={busy}
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          {actionError && (
            <p className="mt-2 text-[11px] text-red-500">{actionError}</p>
          )}
        </div>
      )}
    </article>
  );
}

type MenuItemProps = {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

function MenuItem({ icon, label, onClick, destructive, disabled }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
        destructive
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-foreground hover:bg-accent/40',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function extractRunNowError(cause: unknown): string {
  if (cause instanceof Error) {
    const status = (cause as Error & { status?: number }).status;
    if (status === 409) return 'A run is already in progress.';
    return cause.message;
  }
  return String(cause);
}