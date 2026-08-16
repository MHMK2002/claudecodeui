import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileDiff, Loader2, RotateCcw, ShieldCheck, X } from 'lucide-react';

import type { TaskMasterProject, TaskSetupPlan, TaskSetupProgress, TaskSetupResult } from '../types';
import {
  analyzeTaskSetup,
  applyTaskSetup,
  cancelTaskSetup,
  TaskSetupError,
} from '../taskSetupApi';

type SetupStage = 'idle' | 'analyzing' | 'preview' | 'applying' | 'success' | 'failure';

type TaskMasterSetupWorkspaceProps = {
  project: TaskMasterProject;
  onCancel: () => void;
  onComplete: () => void;
  /** Deterministic setup adapter used by Storybook and component tests. */
  setupApi?: {
    analyze: typeof analyzeTaskSetup;
    apply: typeof applyTaskSetup;
    cancel: typeof cancelTaskSetup;
  };
};

const DEFAULT_TASK_SETUP_API = {
  analyze: analyzeTaskSetup,
  apply: applyTaskSetup,
  cancel: cancelTaskSetup,
};

/** Main-workspace TaskMaster setup wizard; never shells out through a UI terminal. */
export default function TaskMasterSetupWorkspace({
  project,
  onCancel,
  onComplete,
  setupApi = DEFAULT_TASK_SETUP_API,
}: TaskMasterSetupWorkspaceProps) {
  const [stage, setStage] = useState<SetupStage>('idle');
  const [plan, setPlan] = useState<TaskSetupPlan | null>(null);
  const [progress, setProgress] = useState<TaskSetupProgress | null>(null);
  const [result, setResult] = useState<TaskSetupResult | null>(null);
  const [failure, setFailure] = useState<TaskSetupError | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const analyze = async (repair = false) => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setStage('analyzing');
    setFailure(null);
    setProgress(null);
    setResult(null);
    try {
      const nextPlan = await setupApi.analyze(project.projectId, { repair, signal: controller.signal });
      setPlan(nextPlan);
      setStage('preview');
    } catch (error) {
      if (controller.signal.aborted) return;
      setFailure(error instanceof TaskSetupError ? error : new TaskSetupError('Task setup analysis failed.'));
      setStage('failure');
    }
  };

  const apply = async () => {
    if (!plan) return;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setStage('applying');
    setFailure(null);
    setProgress({ stage: 'backup', message: 'Preparing the setup transaction', completed: 0, total: 6 });
    try {
      const nextResult = await setupApi.apply(project.projectId, plan.attemptId, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      setResult(nextResult);
      setStage('success');
    } catch (error) {
      if (controller.signal.aborted) return;
      setFailure(error instanceof TaskSetupError ? error : new TaskSetupError('Task setup failed.'));
      setStage('failure');
    }
  };

  const cancel = async () => {
    if (plan && (stage === 'preview' || stage === 'applying')) {
      setIsCancelling(true);
      await setupApi.cancel(project.projectId, plan.attemptId);
      setIsCancelling(false);
      if (stage === 'applying') return;
    }
    requestControllerRef.current?.abort();
    onCancel();
  };

  const progressPercent = progress
    ? Math.min(100, Math.round((progress.completed / Math.max(progress.total, 1)) * 100))
    : 0;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card shadow-sm">
        <header className="border-b border-border px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Task setup</p>
          <h2 className="mt-1 text-xl font-semibold text-foreground">Set up Tasks for {project.displayName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Analyze first, review every file change, then confirm the backed-up transaction.
          </p>
        </header>

        <ol className="grid grid-cols-5 gap-1 border-b border-border bg-muted/30 px-4 py-3 text-center text-xs text-muted-foreground" aria-label="Task setup stages">
          {['Analyze', 'Preview', 'Confirm', 'Progress', 'Success'].map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>

        <div className="p-5">
          {stage === 'idle' && (
            <section className="text-center">
              <ShieldCheck className="mx-auto h-12 w-12 text-primary" aria-hidden="true" />
              <h3 className="mt-3 text-lg font-semibold text-foreground">Analyze the project safely</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                No project file changes during analysis. The preview lists creates, merges, replacements, and any generated model defaults.
              </p>
              <div className="mt-6 flex justify-center gap-2">
                <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">Cancel</button>
                <button type="button" onClick={() => void analyze()} className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Analyze</button>
              </div>
            </section>
          )}

          {stage === 'analyzing' && (
            <section className="py-10 text-center" role="status">
              <Loader2 className="mx-auto h-9 w-9 animate-spin text-primary" aria-hidden="true" />
              <h3 className="mt-3 font-semibold text-foreground">Analyzing TaskMaster changes…</h3>
              <p className="mt-1 text-sm text-muted-foreground">The project remains unchanged.</p>
              <button type="button" onClick={() => { requestControllerRef.current?.abort(); onCancel(); }} className="mt-5 min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">Cancel</button>
            </section>
          )}

          {stage === 'preview' && plan && (
            <section>
              <div className="flex items-start gap-3">
                <FileDiff className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-foreground">Preview changes</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Existing model defaults will not change. A backup is created before the first write.
                  </p>
                </div>
              </div>
              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-xl border border-border p-3">
                {plan.operations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">TaskMaster is already valid; confirmation will perform validation only.</p>
                ) : plan.operations.map((operation) => (
                  <article key={`${operation.action}:${operation.path}`} className="rounded-lg bg-muted/50 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>{operation.action}</span>
                      <code className="normal-case text-foreground">{operation.path}</code>
                    </div>
                    <p className="mt-1 text-sm text-foreground">{operation.description}</p>
                  </article>
                ))}
              </div>
              {plan.modelDefaults !== null && (
                <details className="mt-3 rounded-lg border border-border p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-foreground">Generated model defaults (new config only)</summary>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(plan.modelDefaults, null, 2)}</pre>
                </details>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => void cancel()} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">Cancel</button>
                <button type="button" onClick={() => void apply()} className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Confirm changes</button>
              </div>
            </section>
          )}

          {stage === 'applying' && progress && (
            <section aria-live="polite">
              <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
              <h3 className="mt-3 font-semibold text-foreground">{progress.message}</h3>
              <p className="mt-1 text-sm capitalize text-muted-foreground">Stage: {progress.stage}</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-primary transition-[width]" style={{ width: `${progressPercent}%` }} />
              </div>
              <button type="button" onClick={() => void cancel()} disabled={isCancelling} className="mt-5 min-h-11 rounded-lg border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60">
                {isCancelling ? 'Cancelling…' : 'Cancel and roll back'}
              </button>
            </section>
          )}

          {stage === 'success' && result && (
            <section className="text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-primary" aria-hidden="true" />
              <h3 className="mt-3 text-lg font-semibold text-foreground">Tasks are ready</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {result.added.length} created, {result.merged.length} merged, {result.replaced.length} repaired.
              </p>
              <button type="button" onClick={onComplete} className="mt-6 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Open Tasks</button>
            </section>
          )}

          {stage === 'failure' && failure && (
            <section role="alert">
              <div className="flex items-start gap-3">
                <X className="mt-0.5 h-5 w-5 text-destructive" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-foreground">Task setup needs recovery</h3>
                  <p className="mt-1 text-sm text-destructive">{failure.message}</p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">Close</button>
                <button type="button" onClick={() => void analyze(failure.recovery === 'REPAIR')} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {failure.recovery === 'REPAIR' ? 'Repair' : 'Retry'}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
