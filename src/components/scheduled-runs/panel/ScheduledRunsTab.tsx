/**
 * Scheduled Runs tab — header + list of `ScheduledRunCard`s + empty state.
 * Owns the local state of the editor modal (create/edit) and forwards
 * actions to `useScheduledRuns`.
 */

import { useCallback, useState } from 'react';
import { Plus } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { useScheduledRuns } from '../../../contexts/ScheduledRunsContext';
import { ScheduledRunCard } from './ScheduledRunCard';
import { ScheduleEditorModal } from '../modals/ScheduleEditorModal';
import type { ScheduledRun } from '../../../types/scheduledRuns';

export function ScheduledRunsTab() {
  const { schedules, loadingList, error } = useScheduledRuns();
  const [editorState, setEditorState] = useState<{ open: boolean; schedule: ScheduledRun | null }>({
    open: false,
    schedule: null,
  });

  const openCreate = useCallback(() => setEditorState({ open: true, schedule: null }), []);
  const openEdit = useCallback(
    (schedule: ScheduledRun) => setEditorState({ open: true, schedule }),
    [],
  );
  const closeEditor = useCallback(
    () => setEditorState({ open: false, schedule: null }),
    [],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Scheduled Agent Runs</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Recurring AI jobs that run on a cron schedule.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
            'bg-foreground text-background transition-opacity hover:opacity-90',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {loadingList && schedules.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">Loading schedules…</div>
        ) : error ? (
          <div className="py-12 text-center text-xs text-red-500">{error}</div>
        ) : schedules.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <div className="flex flex-col gap-2">
            {schedules.map((schedule) => (
              <ScheduledRunCard
                key={schedule.id}
                schedule={schedule}
                onEdit={openEdit}
              />
            ))}
          </div>
        )}
      </div>

      <ScheduleEditorModal
        open={editorState.open}
        editingSchedule={editorState.schedule}
        onClose={closeEditor}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div
        className={cn(
          'mb-3 flex h-12 w-12 items-center justify-center rounded-full',
          'border border-dashed border-border bg-background/50 text-muted-foreground',
        )}
      >
        <Plus className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground">No schedules yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Schedule an agent to run on a recurring cron and notify you when it's done.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className={cn(
          'mt-4 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium',
          'bg-foreground text-background transition-opacity hover:opacity-90',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Create your first schedule
      </button>
    </div>
  );
}