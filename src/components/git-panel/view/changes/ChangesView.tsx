import { ArrowRight, GitCommit, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ConfirmationRequest,
  FileStatusCode,
  GitCommitResult,
  GitDiffMap,
  GitRemoteStatus,
  GitStatusResponse,
} from '../../types/types';
import { getAllChangedFiles, hasChangedFiles } from '../../utils/gitPanelUtils';
import { useCommitMessageSuggestion } from '../../hooks/useCommitMessageSuggestion';

import CommitComposer from './CommitComposer';
import FileChangeList from './FileChangeList';
import FileStatusLegend from './FileStatusLegend';

type ChangesViewProps = {
  isMobile: boolean;
  projectId: string;
  gitStatus: GitStatusResponse | null;
  gitDiff: GitDiffMap;
  remoteStatus: GitRemoteStatus | null;
  isLoading: boolean;
  wrapText: boolean;
  isRecoveryActive: boolean;
  onWrapTextChange: (wrapText: boolean) => void;
  onOpenFile: (filePath: string) => Promise<void>;
  onDiscardFile: (filePath: string) => Promise<void>;
  onDeleteFile: (filePath: string) => Promise<void>;
  onStageFiles: (files: string[]) => Promise<boolean>;
  onUnstageFiles: (files: string[]) => Promise<boolean>;
  onCommitChanges: (
    message: string,
    files: string[],
    expectedSnapshotId?: string,
  ) => Promise<GitCommitResult>;
  onOpenAgentSettings: () => void;
  onOpenGitSettings: () => void;
  onReviewStagedChanges: () => void;
  onRequestConfirmation: (request: ConfirmationRequest) => void;
  onExpandedFilesChange: (hasExpandedFiles: boolean) => void;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function RepositorySummary({
  gitStatus,
  remoteStatus,
  changedFileCount,
  stagedFileCount,
}: {
  gitStatus: GitStatusResponse;
  remoteStatus: GitRemoteStatus | null;
  changedFileCount: number;
  stagedFileCount: number;
}) {
  const unstagedFileCount = Math.max(0, changedFileCount - stagedFileCount);
  const breakdown = [
    [gitStatus.modified?.length ?? 0, 'modified'],
    [gitStatus.added?.length ?? 0, 'added'],
    [gitStatus.deleted?.length ?? 0, 'deleted'],
    [gitStatus.untracked?.length ?? 0, 'untracked'],
  ] as const;
  const breakdownLabel = breakdown
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(' · ') || 'No file changes';
  const remoteLabel = remoteStatus?.hasRemote
    ? remoteStatus.remoteBranch ?? `${remoteStatus.remoteName ?? 'remote'}/${gitStatus.branch ?? 'current'}`
    : 'No remote';
  const ahead = remoteStatus?.ahead ?? 0;
  const behind = remoteStatus?.behind ?? 0;
  const syncLabel = remoteStatus?.hasRemote
    ? ahead === 0 && behind === 0
      ? 'Up to date'
      : `${pluralize(ahead, 'commit')} ahead · ${pluralize(behind, 'commit')} behind`
    : 'Publish this branch to connect a remote';
  const nextStep = changedFileCount === 0
    ? 'Working tree clean. There is nothing to commit.'
    : stagedFileCount === 0
      ? 'Next: review a diff, then stage the files you want to commit.'
      : `Next: add a commit message for ${pluralize(stagedFileCount, 'staged file')} and commit.`;

  return (
    <section
      aria-labelledby="repository-summary-heading"
      className="border-b border-border bg-muted/20 px-4 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="repository-summary-heading" className="text-sm font-semibold text-foreground">
            Repository summary
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {pluralize(changedFileCount, 'changed file')} · {breakdownLabel}
          </p>
        </div>
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground">
          {gitStatus.branch || 'Unknown branch'}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ready to commit</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{pluralize(stagedFileCount, 'staged file')}</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Needs review</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{pluralize(unstagedFileCount, 'unstaged file')}</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remote</p>
          <p className="mt-1 truncate text-sm font-semibold text-foreground" title={remoteLabel}>{remoteLabel}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{syncLabel}</p>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{nextStep}</span>
      </p>
    </section>
  );
}

export default function ChangesView({
  isMobile,
  projectId,
  gitStatus,
  gitDiff,
  remoteStatus,
  isLoading,
  wrapText,
  isRecoveryActive,
  onWrapTextChange,
  onOpenFile,
  onDiscardFile,
  onDeleteFile,
  onStageFiles,
  onUnstageFiles,
  onCommitChanges,
  onOpenAgentSettings,
  onOpenGitSettings,
  onReviewStagedChanges,
  onRequestConfirmation,
  onExpandedFilesChange,
}: ChangesViewProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  // Internal Git-tab navigation remounts this view while the controller still
  // owns a current status snapshot. Seed from it so cached generated
  // provenance is not compared against a synthetic empty staged set.
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(
    () => new Set(gitStatus?.staged ?? []),
  );
  // Stage/unstage calls in flight or queued. While > 0, status refreshes must
  // not overwrite the optimistic selection with a snapshot that predates the
  // later clicks.
  const [pendingStageOps, setPendingStageOps] = useState(0);
  // Serializes stage/unstage requests so rapid toggles cannot interleave on
  // the server or resolve out of order.
  const stageOpQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const changedFiles = useMemo(() => getAllChangedFiles(gitStatus), [gitStatus]);
  const hasExpandedFiles = expandedFiles.size > 0;
  const stagedFiles = useMemo(
    () => Array.from(selectedFiles).sort((left, right) => left.localeCompare(right)),
    [selectedFiles],
  );
  const commitMessageSuggestion = useCommitMessageSuggestion({
    projectId,
    stagedFiles,
    hasPendingStageOperations: pendingStageOps > 0,
  });

  const enqueueStageOp = useCallback((operation: () => Promise<unknown>) => {
    setPendingStageOps((count) => count + 1);
    stageOpQueueRef.current = stageOpQueueRef.current
      .catch(() => {}) // a failed op must not block the queue
      .then(operation)
      .finally(() => setPendingStageOps((count) => count - 1));
  }, []);

  useEffect(() => {
    if (!gitStatus || gitStatus.error) {
      setSelectedFiles(new Set());
      return;
    }

    if (pendingStageOps > 0) {
      return; // keep the optimistic state until the queued ops settle
    }

    // The Staged section mirrors the real git index reported by /status, so
    // files staged outside the app (VSCode, terminal) show up here too. Also
    // re-runs when the queue drains, syncing to the final refreshed status.
    setSelectedFiles(new Set(gitStatus.staged ?? []));
  }, [gitStatus, pendingStageOps]);

  useEffect(() => {
    onExpandedFilesChange(hasExpandedFiles);
  }, [hasExpandedFiles, onExpandedFilesChange]);

  useEffect(() => {
    return () => {
      onExpandedFilesChange(false);
    };
  }, [onExpandedFilesChange]);

  const toggleFileExpanded = useCallback((filePath: string) => {
    setExpandedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  // Staging is real: every toggle runs git add / git reset through the API.
  // The set is flipped optimistically; the queued API call keeps the git
  // index in sync and the final status refresh re-syncs once the queue drains.
  const toggleFileSelected = useCallback(
    (filePath: string) => {
      const isStaged = selectedFiles.has(filePath);
      setSelectedFiles((previous) => {
        const next = new Set(previous);
        if (isStaged) {
          next.delete(filePath);
        } else {
          next.add(filePath);
        }
        return next;
      });
      enqueueStageOp(() => (isStaged ? onUnstageFiles([filePath]) : onStageFiles([filePath])));
    },
    [enqueueStageOp, onStageFiles, onUnstageFiles, selectedFiles],
  );

  const requestFileAction = useCallback(
    (filePath: string, status: FileStatusCode) => {
      if (status === 'U') {
        onRequestConfirmation({
          type: 'delete',
          message: `Delete untracked file "${filePath}"? Undo will be offered when a safe file snapshot can be created.`,
          onConfirm: async () => {
            await onDeleteFile(filePath);
          },
        });
        return;
      }

      onRequestConfirmation({
        type: 'discard',
        message: `Discard all changes to "${filePath}"? Undo will be offered when a safe file snapshot can be created.`,
        onConfirm: async () => {
          await onDiscardFile(filePath);
        },
      });
    },
    [onDeleteFile, onDiscardFile, onRequestConfirmation],
  );

  const commitSelectedFiles = useCallback(
    (message: string, expectedSnapshotId?: string) => {
      return onCommitChanges(message, stagedFiles, expectedSnapshotId);
    },
    [onCommitChanges, stagedFiles],
  );

  const unstagedFiles = useMemo(
    () => new Set(changedFiles.filter((f) => !selectedFiles.has(f))),
    [changedFiles, selectedFiles],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {!isLoading && gitStatus && !gitStatus.error && (
        <RepositorySummary
          gitStatus={gitStatus}
          remoteStatus={remoteStatus}
          changedFileCount={changedFiles.length}
          stagedFileCount={selectedFiles.size}
        />
      )}

      {!isRecoveryActive && (
        <CommitComposer
          isMobile={isMobile}
          selectedFileCount={selectedFiles.size}
          hasPendingStageOperations={pendingStageOps > 0}
          isHidden={hasExpandedFiles}
          suggestion={commitMessageSuggestion}
          onCommit={commitSelectedFiles}
          onOpenAgentSettings={onOpenAgentSettings}
          onOpenGitSettings={onOpenGitSettings}
          onReviewStagedChanges={onReviewStagedChanges}
          onRequestConfirmation={onRequestConfirmation}
        />
      )}

      {!gitStatus?.error && <FileStatusLegend isMobile={isMobile} />}
      {!gitStatus?.error && !isLoading && changedFiles.length > 0 && (
        <p className="border-b border-border bg-background px-4 py-3 text-sm text-muted-foreground">
          Review a file’s diff here or open it in the editor. Use its checkbox to move it into or out of the next commit.
        </p>
      )}

      <div>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !gitStatus || !hasChangedFiles(gitStatus) ? (
          <div className="flex h-32 flex-col items-center justify-center text-muted-foreground">
            <GitCommit className="mb-2 h-10 w-10 opacity-40" />
            <p className="text-sm">No changes detected</p>
          </div>
        ) : (
          <div className={isMobile ? 'pb-4' : ''}>
            {/* STAGED section */}
            <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2">
              <span className="text-sm font-semibold text-foreground">
                Staged for commit <span className="font-normal text-muted-foreground">({selectedFiles.size})</span>
              </span>
              {selectedFiles.size > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const filesToUnstage = Array.from(selectedFiles);
                    setSelectedFiles(new Set());
                    enqueueStageOp(() => onUnstageFiles(filesToUnstage));
                  }}
                  className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Unstage all {pluralize(selectedFiles.size, 'file')}
                </button>
              )}
            </div>
            {selectedFiles.size === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                No files are staged yet. Stage reviewed files below to prepare the commit.
              </div>
            ) : (
              <FileChangeList
                gitStatus={gitStatus}
                gitDiff={gitDiff}
                expandedFiles={expandedFiles}
                selectedFiles={selectedFiles}
                isMobile={isMobile}
                wrapText={wrapText}
                filePaths={selectedFiles}
                onToggleSelected={toggleFileSelected}
                onToggleExpanded={toggleFileExpanded}
                onOpenFile={(filePath) => { void onOpenFile(filePath); }}
                onToggleWrapText={() => onWrapTextChange(!wrapText)}
                onRequestFileAction={requestFileAction}
              />
            )}

            {/* CHANGES section */}
            <div className="flex min-h-12 items-center justify-between gap-3 border-y border-border bg-muted/30 px-4 py-2">
              <span className="text-sm font-semibold text-foreground">
                Unstaged changes <span className="font-normal text-muted-foreground">({unstagedFiles.size})</span>
              </span>
              {unstagedFiles.size > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const filesToStage = Array.from(unstagedFiles);
                    setSelectedFiles(new Set(changedFiles));
                    enqueueStageOp(() => onStageFiles(filesToStage));
                  }}
                  className="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Stage all {pluralize(unstagedFiles.size, 'file')}
                </button>
              )}
            </div>
            {unstagedFiles.size === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">All reviewed changes are staged.</div>
            ) : (
              <FileChangeList
                gitStatus={gitStatus}
                gitDiff={gitDiff}
                expandedFiles={expandedFiles}
                selectedFiles={selectedFiles}
                isMobile={isMobile}
                wrapText={wrapText}
                filePaths={unstagedFiles}
                onToggleSelected={toggleFileSelected}
                onToggleExpanded={toggleFileExpanded}
                onOpenFile={(filePath) => { void onOpenFile(filePath); }}
                onToggleWrapText={() => onWrapTextChange(!wrapText)}
                onRequestFileAction={requestFileAction}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
