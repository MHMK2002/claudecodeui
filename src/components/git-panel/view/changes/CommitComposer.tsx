import { Check, ChevronDown, GitCommit, Sparkles } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import type {
  CommitMessageSuggestionController,
  ConfirmationRequest,
  GitCommitResult,
} from '../../types/types';
import { getTextDirection } from '../../../../utils/textDirection';

export type CommitComposerProps = {
  isMobile: boolean;
  selectedFileCount: number;
  hasPendingStageOperations: boolean;
  isHidden: boolean;
  suggestion: CommitMessageSuggestionController;
  onCommit: (message: string, expectedSnapshotId?: string) => Promise<GitCommitResult>;
  onOpenAgentSettings: () => void;
  onOpenGitSettings: () => void;
  onReviewStagedChanges: () => void;
  onRequestConfirmation: (request: ConfirmationRequest) => void;
};

function NeutralAction({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export default function CommitComposer({
  isMobile,
  selectedFileCount,
  hasPendingStageOperations,
  isHidden,
  suggestion,
  onCommit,
  onOpenAgentSettings,
  onOpenGitSettings,
  onReviewStagedChanges,
  onRequestConfirmation,
}: CommitComposerProps) {
  const commitMessage = suggestion.state.message;
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(isMobile);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousSuggestionStatusRef = useRef(suggestion.state.status);
  const messageId = useId();
  const helpId = useId();
  const disclosureId = useId();
  const statusId = useId();
  const hasMessage = Boolean(commitMessage.trim());
  const canCommit = hasMessage
    && selectedFileCount > 0
    && !hasPendingStageOperations
    && !suggestion.isCommitBlockedByStaleSuggestion
    && !isCommitting;
  const commitHelp = suggestion.isCommitBlockedByStaleSuggestion
    ? 'Regenerate the suggestion or keep the current message as manual before committing.'
    : hasPendingStageOperations
      ? 'Wait for staging to finish before committing.'
      : selectedFileCount === 0
    ? 'Stage at least one file to enable Commit.'
    : !hasMessage
      ? 'Add a commit message to enable Commit.'
      : `${selectedFileCount} staged file${selectedFileCount === 1 ? '' : 's'} ready to commit. Ctrl+Enter also commits.`;

  const keepsComposerVisible = suggestion.isBusy
    || ['applied', 'suggestion', 'stale', 'error'].includes(suggestion.state.status);
  const isVisuallyHidden = isHidden && !keepsComposerVisible;
  const showCollapsedMobile = isMobile && isCollapsed && !keepsComposerVisible;

  useEffect(() => {
    const previousStatus = previousSuggestionStatusRef.current;
    previousSuggestionStatusRef.current = suggestion.state.status;
    if (suggestion.state.status !== 'applied' || previousStatus === 'applied') return;
    const textarea = textareaRef.current;
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [suggestion.state.status, suggestion.state.message]);

  const handleCommit = async (message = commitMessage) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || !canCommit) {
      return false;
    }

    setIsCommitting(true);
    try {
      suggestion.invalidateForCommit();
      const result = await onCommit(trimmedMessage, suggestion.commitSnapshotId ?? undefined);
      if (result.success) {
        suggestion.clearAfterCommit();
        return true;
      }
      if (result.code === 'STAGED_CHANGES_CHANGED') {
        suggestion.markCommitConflict();
      }
      return false;
    } finally {
      setIsCommitting(false);
    }
  };

  const requestCommitConfirmation = () => {
    const trimmedMessage = commitMessage.trim();
    if (!trimmedMessage || !canCommit) {
      return;
    }

    onRequestConfirmation({
      type: 'commit',
      message: `Commit ${selectedFileCount} file${selectedFileCount !== 1 ? 's' : ''} with message: "${trimmedMessage}"?`,
      onConfirm: async () => {
        await handleCommit(trimmedMessage);
      },
    });
  };

  const dismissSuggestion = () => {
    suggestion.dismissSuggestion();
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const visibleAnalysis = suggestion.state.candidate?.analysis ?? suggestion.state.analysis;
  const partialAnalysisNote = visibleAnalysis?.truncated
    ? `Analyzed ${visibleAnalysis.sampledFiles} of ${visibleAnalysis.totalStagedFiles} staged files with bounded excerpts; large, binary, or additional content was omitted.`
    : null;
  const showStandardGenerate = !suggestion.isBusy
    && !['error', 'stale', 'suggestion'].includes(suggestion.state.status);

  return (
    <section aria-label="Commit composer" className={isVisuallyHidden ? 'hidden' : ''}>
      {showCollapsedMobile ? (
        <div className="border-b border-border/60 px-4 py-2">
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GitCommit className="h-4 w-4" />
            <span>Write or generate commit message · {selectedFileCount} staged</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="border-b border-border/60 px-4 py-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <label htmlFor={messageId} className="text-sm font-semibold text-foreground">
                Commit staged changes
              </label>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Only files in “Staged for commit” will be included.
              </p>
            </div>
            {isMobile && (
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Collapse commit composer"
              >
                <ChevronDown className="h-4 w-4 rotate-180" />
              </button>
            )}
          </div>

          <textarea
            ref={textareaRef}
            id={messageId}
            value={commitMessage}
            dir={getTextDirection(commitMessage)}
            onChange={(event) => suggestion.setMessage(event.target.value)}
            placeholder="Describe what changed and why"
            aria-describedby={`${helpId} ${disclosureId} ${statusId}`}
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            rows={3}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void handleCommit();
              }
            }}
          />

          <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <p id={disclosureId} className="text-sm text-muted-foreground">
                Uses {suggestion.selectedProviderLabel} to analyze a bounded snapshot of staged changes and recent commit subjects.
              </p>
              {suggestion.isBusy ? (
                <NeutralAction onClick={suggestion.cancel}>Cancel</NeutralAction>
              ) : showStandardGenerate ? (
                <NeutralAction onClick={suggestion.generate} disabled={!suggestion.canGenerate}>
                  <span className="inline-flex items-center gap-2">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    Generate message
                  </span>
                </NeutralAction>
              ) : null}
            </div>

            {showStandardGenerate && suggestion.generateDisabledReason && (
              <p className="mt-2 text-sm text-muted-foreground">
                {suggestion.generateDisabledReason}
              </p>
            )}

            <div id={statusId} className="mt-2">
              {suggestion.state.status === 'checking-provider' && (
                <p role="status" aria-live="polite" className="text-sm text-foreground">
                  Checking provider…
                </p>
              )}
              {suggestion.state.status === 'generating' && (
                <p role="status" aria-live="polite" className="text-sm text-foreground">
                  Generating from {selectedFileCount} staged file{selectedFileCount === 1 ? '' : 's'}…
                </p>
              )}
              {suggestion.state.status === 'applied' && (
                <div role="status" aria-live="polite" className="text-sm text-foreground">
                  <p>Suggestion ready. Review before committing.</p>
                  {partialAnalysisNote && <p className="mt-1 text-muted-foreground">{partialAnalysisNote}</p>}
                </div>
              )}
              {suggestion.state.status === 'cancelled' && (
                <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                  Generation cancelled. Your draft was not changed.
                </p>
              )}
              {suggestion.state.status === 'suggestion' && suggestion.state.candidate && (
                <section aria-label="Generated commit-message suggestion" className="mt-3 border-t border-border pt-3">
                  <p className="text-sm font-semibold text-foreground">Suggested message</p>
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 font-sans text-sm text-foreground">
                    {suggestion.state.candidate.message}
                  </pre>
                  {partialAnalysisNote && <p className="mt-2 text-sm text-muted-foreground">{partialAnalysisNote}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <NeutralAction onClick={suggestion.useSuggestion}>Use suggestion</NeutralAction>
                    <NeutralAction onClick={dismissSuggestion}>Dismiss</NeutralAction>
                  </div>
                </section>
              )}
              {suggestion.isCommitBlockedByStaleSuggestion && (
                <section aria-label="Stale generated commit message" className="mt-3 border-t border-border pt-3">
                  <p role="alert" className="text-sm font-medium text-foreground">
                    Staged changes changed after this suggestion was generated.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <NeutralAction
                      onClick={suggestion.updateSuggestion}
                      disabled={!suggestion.canGenerate}
                    >
                      Update suggestion
                    </NeutralAction>
                    <NeutralAction onClick={suggestion.keepCurrentMessage}>Keep current message</NeutralAction>
                  </div>
                  {suggestion.generateDisabledReason && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {suggestion.generateDisabledReason}
                    </p>
                  )}
                </section>
              )}
              {suggestion.state.status === 'error' && suggestion.state.error && (
                <section role="alert" className="mt-3 border-t border-border pt-3 text-sm">
                  <p className="font-medium text-foreground">{suggestion.state.error.error}</p>
                  <p className="mt-1 text-muted-foreground">{suggestion.state.error.details}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {suggestion.state.error.action === 'OPEN_AGENT_SETTINGS' ? (
                      <NeutralAction onClick={onOpenAgentSettings}>Open Agent Settings</NeutralAction>
                    ) : suggestion.state.error.action === 'OPEN_GIT_SETTINGS' ? (
                      <NeutralAction onClick={onOpenGitSettings}>Open Git Settings</NeutralAction>
                    ) : suggestion.state.error.action === 'REVIEW_STAGED_CHANGES' ? (
                      <NeutralAction onClick={onReviewStagedChanges}>Review staged changes</NeutralAction>
                    ) : (
                      <NeutralAction onClick={suggestion.retry}>Retry</NeutralAction>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p id={helpId} className="text-sm text-muted-foreground">{commitHelp}</p>
            <button
              type="button"
              onClick={requestCommitConfirmation}
              disabled={!canCommit}
              aria-describedby={helpId}
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-3 w-3" />
              <span>{isCommitting ? 'Committing…' : 'Commit'}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
