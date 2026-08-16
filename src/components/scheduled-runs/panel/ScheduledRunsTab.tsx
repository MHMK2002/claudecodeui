/**
 * Scheduled Runs tab — header + list of `ScheduledRunCard`s + empty state.
 * Owns the local state of the editor modal (create/edit) and forwards
 * actions to `useScheduledRuns`.
 */

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { useScheduledRuns } from '../../../contexts/ScheduledRunsContext';
import { ScheduledRunCard } from './ScheduledRunCard';
import type { ScheduledRun } from '../../../types/scheduledRuns';
import { useTaskMaster } from '../../task-master/context/TaskMasterContext';

type ScheduledRunsTabProps = {
  onCreate: () => void;
  onEdit: (schedule: ScheduledRun) => void;
  onOpenAgentSettings: () => void;
};

export function ScheduledRunsTab({ onCreate, onEdit, onOpenAgentSettings }: ScheduledRunsTabProps) {
  const { currentProject } = useTaskMaster();
  const { schedules, loadingList, error, refresh, stageRemove, undoRemove } = useScheduledRuns();
  const [pendingUndo, setPendingUndo] = useState<ScheduledRun | null>(null);
  const undoNoticeTimerRef = useRef<number | null>(null);
  const projectPath = currentProject?.fullPath || currentProject?.path;
  const projectSchedules = schedules.filter((schedule) => (
    schedule.projectId
      ? schedule.projectId === currentProject?.projectId
      : Boolean(projectPath && schedule.projectPath === projectPath)
  ));

  useEffect(() => () => {
    if (undoNoticeTimerRef.current) window.clearTimeout(undoNoticeTimerRef.current);
  }, []);

  const handleDelete = (schedule: ScheduledRun) => {
    const staged = stageRemove(schedule.id);
    if (!staged) return;
    if (undoNoticeTimerRef.current) window.clearTimeout(undoNoticeTimerRef.current);
    setPendingUndo(staged);
    undoNoticeTimerRef.current = window.setTimeout(() => {
      setPendingUndo(null);
      undoNoticeTimerRef.current = null;
    }, 8_100);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Scheduled Agent Runs</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Recurring local agent work for this project.
          </p>
        </div>
        {projectSchedules.length > 0 && (
          <button
            type="button"
            onClick={onCreate}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground',
              'transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            New schedule
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {pendingUndo && (
          <div className="mb-3 rounded-lg border border-border bg-card p-3 text-xs text-foreground" role="status">
            <p>“{pendingUndo.title}” will be deleted.</p>
            <button
              type="button"
              onClick={() => {
                if (undoRemove(pendingUndo.id)) setPendingUndo(null);
              }}
              className="mt-2 min-h-11 rounded-lg border border-border bg-background px-3 py-2 font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Undo
            </button>
          </div>
        )}
        {loadingList && projectSchedules.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">Loading schedules…</div>
        ) : error ? (
          <div className="py-12 text-center text-xs text-destructive" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void refresh()} className="mt-3 min-h-11 rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground">Retry</button>
          </div>
        ) : projectSchedules.length === 0 ? (
          <EmptyState onCreate={onCreate} />
        ) : (
          <div className="flex flex-col gap-2">
            {projectSchedules.map((schedule) => (
              <ScheduledRunCard
                key={schedule.id}
                schedule={schedule}
                onEdit={onEdit}
                onDelete={handleDelete}
                onOpenAgentSettings={onOpenAgentSettings}
              />
            ))}
          </div>
        )}
      </div>
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
        Schedule an agent to run at a recurring local time and notify you when it's done.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className={cn(
          'mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium',
          'bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Create your first schedule
      </button>
    </div>
  );
}
