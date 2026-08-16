import { AlertTriangle, Loader2, RotateCcw, X } from 'lucide-react';

import type { GitOperationIssue, GitRecoveryAction } from '../types/types';

type GitRecoveryBannerProps = {
  issue: GitOperationIssue | null;
  operation: 'merge' | 'rebase' | null;
  conflicts: string[];
  undoState: { token: string; message: string } | null;
  isContinuingOperation: boolean;
  isAbortingOperation: boolean;
  isUndoingFileAction: boolean;
  onRecover: (action: GitRecoveryAction) => void;
  onResolveConflicts: () => void;
  onContinueOperation: (operation: 'merge' | 'rebase') => void;
  onRequestAbort: (operation: 'merge' | 'rebase') => void;
  onUndo: () => void;
  onDismissIssue?: () => void;
};

const RECOVERY_LABELS: Record<GitRecoveryAction, string> = {
  INSTALL_GIT: 'Install Git',
  INITIALIZE_REPOSITORY: 'Initialize repository',
  OPEN_GIT_SETTINGS: 'Open Git Settings',
  RETRY: 'Retry',
  REVIEW_CHANGES: 'Review changes',
  RESOLVE_CONFLICTS: 'Resolve conflicts',
  CREATE_BRANCH: 'Create or switch branch',
};

/** Renders the single contextual recovery path for Source Control failures. */
export default function GitRecoveryBanner({
  issue,
  operation,
  conflicts,
  undoState,
  isContinuingOperation,
  isAbortingOperation,
  isUndoingFileAction,
  onRecover,
  onResolveConflicts,
  onContinueOperation,
  onRequestAbort,
  onUndo,
  onDismissIssue,
}: GitRecoveryBannerProps) {
  const operationName = operation === 'merge' ? 'Merge' : 'Rebase';
  const operationPending = isContinuingOperation || isAbortingOperation;

  return (
    <>
      {operation && (
        <section
          className="border-b border-border bg-muted px-4 py-3 text-foreground"
          aria-labelledby="git-operation-title"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 id="git-operation-title" className="text-sm font-semibold">
                {operationName} in progress
              </h3>
              <p className="mt-1 text-sm">
                {conflicts.length > 0
                  ? `${conflicts.length} conflicted file${conflicts.length === 1 ? '' : 's'} must be resolved and staged.`
                  : `All conflicts are resolved. Continue the ${operation}.`}
              </p>
              {issue && (
                <p className="mt-2 text-sm font-medium text-destructive" role="alert">
                  {issue.error}: {issue.details}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={conflicts.length > 0
                    ? onResolveConflicts
                    : () => onContinueOperation(operation)}
                  disabled={operationPending}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isContinuingOperation && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {conflicts.length > 0 ? 'Resolve conflicts' : `Continue ${operation}`}
                </button>
                <button
                  type="button"
                  onClick={() => onRequestAbort(operation)}
                  disabled={operationPending}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAbortingOperation && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Abort {operation}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {issue && !operation && (
        <section
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-foreground"
          role="alert"
          aria-labelledby="git-recovery-title"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 id="git-recovery-title" className="text-sm font-semibold">{issue.error}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{issue.details}</p>
              <div className="mt-3">
                {issue.action === 'INSTALL_GIT' ? (
                  <a
                    href="https://git-scm.com/downloads"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {RECOVERY_LABELS[issue.action]}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRecover(issue.action)}
                    className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {RECOVERY_LABELS[issue.action]}
                  </button>
                )}
              </div>
            </div>
            {onDismissIssue && (
              <button
                type="button"
                onClick={onDismissIssue}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Dismiss source control error"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </section>
      )}

      {undoState && (
        <section
          className="flex items-center gap-3 border-b border-border bg-muted px-4 py-2 text-sm text-foreground"
          role="status"
          aria-live="polite"
        >
          <span className="min-w-0 flex-1 truncate">{undoState.message}</span>
          <button
            type="button"
            onClick={onUndo}
            disabled={isUndoingFileAction}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUndoingFileAction
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
            Undo
          </button>
        </section>
      )}
    </>
  );
}
