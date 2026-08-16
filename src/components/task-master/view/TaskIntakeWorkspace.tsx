import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, MessageSquareText, RefreshCw } from 'lucide-react';

import type { TaskMasterProject } from '../types';
import {
  approveTaskIntake,
  listTaskIntakes,
  startTaskIntake,
  type TaskIntakeRecord,
  type TaskWorkflowCallbacks,
} from '../workflow';

type TaskIntakeWorkspaceProps = TaskWorkflowCallbacks & {
  project: TaskMasterProject;
  onCancel: () => void;
  onTaskCreated: () => void;
  onOpenAgentSettings: () => void;
  /** Deterministic workflow adapter used by Storybook and component tests. */
  workflowApi?: {
    list: typeof listTaskIntakes;
    start: typeof startTaskIntake;
    approve: typeof approveTaskIntake;
  };
};

const DEFAULT_TASK_INTAKE_API = {
  list: listTaskIntakes,
  start: startTaskIntake,
  approve: approveTaskIntake,
};

/** Main-workspace task intake surface replacing the former Create Task modal. */
export default function TaskIntakeWorkspace({
  project,
  onCancel,
  onTaskCreated,
  onOpenAgentSettings,
  sendMessage,
  onSessionEstablished,
  onNavigateToSession,
  onSessionProcessing,
  workflowApi = DEFAULT_TASK_INTAKE_API,
}: TaskIntakeWorkspaceProps) {
  const [brief, setBrief] = useState('');
  const [intakes, setIntakes] = useState<TaskIntakeRecord[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [activeApproval, setActiveApproval] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIntakes(await workflowApi.list(project));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load task proposals.');
    }
  }, [project, workflowApi]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const start = async () => {
    if (!brief.trim() || isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      await workflowApi.start({
        project,
        brief: brief.trim(),
        sendMessage,
        onSessionEstablished,
        onNavigateToSession,
        onSessionProcessing,
      });
      setBrief('');
      onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to start task clarification.');
    } finally {
      setIsStarting(false);
    }
  };

  const approve = async (intake: TaskIntakeRecord) => {
    setActiveApproval(intake.id);
    setError(null);
    try {
      await workflowApi.approve({ project, intake });
      await refresh();
      onTaskCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to approve the task.');
    } finally {
      setActiveApproval(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Create task</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Describe the outcome to clarify</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Provider authentication is requested only when the Q&amp;A session starts.
          </p>
          <label htmlFor="task-workspace-brief" className="mt-5 block text-sm font-medium text-foreground">What should be built?</label>
          <textarea
            id="task-workspace-brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={5}
            placeholder="Describe the outcome, constraints, and acceptance signals."
            className="mt-2 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          {error && (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              <p>{error}</p>
              {/provider|profile|model|settings|connect/i.test(error) && (
                <button type="button" onClick={onOpenAgentSettings} className="mt-2 min-h-11 rounded-lg border border-destructive/40 px-3 py-2 font-medium hover:bg-destructive/10">Open Agent Settings</button>
              )}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">Cancel</button>
            <button type="button" onClick={() => void start()} disabled={!brief.trim() || isStarting} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
              {isStarting ? 'Opening Q&A…' : 'Start Q&A'}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-foreground">Clarified proposals</h3>
              <p className="text-sm text-muted-foreground">Approve only proposals with every material question resolved.</p>
            </div>
            <button type="button" onClick={() => void refresh()} className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent" aria-label="Refresh task proposals">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {intakes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No proposals yet.</p>
            ) : intakes.map((intake) => (
              <article key={intake.id} className="rounded-xl border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{intake.proposal?.title || intake.brief}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {intake.taskId ? `Approved as Task ${intake.taskId}` : intake.proposalReady ? 'Ready for approval' : 'Clarification still required'}
                    </p>
                  </div>
                  {intake.proposalReady && !intake.taskId && (
                    <button type="button" onClick={() => void approve(intake)} disabled={activeApproval !== null} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60">
                      {activeApproval === intake.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Approve
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
