import { useCallback, useState } from 'react';

import { normalizeGitIssue, useGitPanelController } from '../hooks/useGitPanelController';
import { useRevertLocalCommit } from '../hooks/useRevertLocalCommit';
import type { ConfirmationRequest, GitPanelProps, GitPanelView, GitRecoveryAction } from '../types/types';
import { getChangedFileCount } from '../utils/gitPanelUtils';
import ChangesView from '../view/changes/ChangesView';
import HistoryView from '../view/history/HistoryView';
import BranchesView from '../view/branches/BranchesView';
import WorktreesView from '../view/worktrees/WorktreesView';
import GitPanelHeader from '../view/GitPanelHeader';
import GitRepositoryErrorState from '../view/GitRepositoryErrorState';
import GitRecoveryBanner from '../view/GitRecoveryBanner';
import GitViewTabs from '../view/GitViewTabs';
import ConfirmActionModal from '../view/modals/ConfirmActionModal';

export default function GitPanel({
  selectedProject,
  isMobile = false,
  onFileOpen,
  onProjectSelect,
  onProjectsRefresh,
  onShowSettings,
}: GitPanelProps) {
  const [activeView, setActiveView] = useState<GitPanelView>('changes');
  const [wrapText, setWrapText] = useState(true);
  const [hasExpandedFiles, setHasExpandedFiles] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmationRequest | null>(null);

  const {
    gitStatus,
    gitDiff,
    isLoading,
    isLoadingCommits,
    currentBranch,
    branches,
    localBranches,
    remoteBranches,
    recentCommits,
    commitDiffs,
    remoteStatus,
    isCreatingBranch,
    isFetching,
    isPulling,
    isPushing,
    isPublishing,
    isInitializingRepository,
    isContinuingOperation,
    isAbortingOperation,
    isUndoingFileAction,
    operationError,
    undoState,
    clearOperationError,
    refreshAll,
    switchBranch,
    createBranch,
    deleteBranch,
    handleFetch,
    handlePull,
    handlePush,
    handlePublish,
    continueGitOperation,
    abortGitOperation,
    discardChanges,
    deleteUntrackedFile,
    undoLastFileAction,
    stageFiles,
    unstageFiles,
    fetchCommitDiff,
    commitChanges,
    initRepository,
    openFile,
  } = useGitPanelController({
    selectedProject,
    activeView,
    onFileOpen,
  });

  const { isRevertingLocalCommit, revertLatestLocalCommit } = useRevertLocalCommit({
    // `projectId` (DB primary key) is forwarded to the revert API which uses it
    // as the `project` body param.
    projectId: selectedProject?.projectId ?? null,
    onSuccess: refreshAll,
  });

  const executeConfirmedAction = useCallback(async () => {
    if (!confirmAction) return;
    const actionToExecute = confirmAction;
    setConfirmAction(null);
    try {
      await actionToExecute.onConfirm();
    } catch (error) {
      console.error('Error executing confirmation action:', error);
    }
  }, [confirmAction]);

  const changeCount = getChangedFileCount(gitStatus);
  // Without a repository the branch/fetch/refresh header controls are all
  // meaningless — hide the whole header and let the init state own the panel.
  const isMissingRepository = Boolean(gitStatus?.notGitRepository);
  const repositoryIssue = gitStatus?.error
    ? normalizeGitIssue(gitStatus, 'Source control is unavailable')
    : null;
  const detachedHeadIssue = gitStatus?.detachedHead
    ? {
        code: 'DETACHED_HEAD' as const,
        error: 'Detached HEAD',
        details: 'Create or switch to a branch before publishing changes.',
        action: 'CREATE_BRANCH' as const,
      }
    : null;
  const visibleIssue = operationError ?? repositoryIssue ?? detachedHeadIssue;
  const activeOperation = gitStatus?.operation ?? null;
  const conflicts = gitStatus?.conflicts ?? [];

  const resolveConflicts = () => {
    setActiveView('changes');
    const firstConflict = conflicts[0];
    if (firstConflict) void openFile(firstConflict);
  };

  const recoverFromIssue = (action: GitRecoveryAction) => {
    if (action === 'OPEN_GIT_SETTINGS') {
      onShowSettings?.('git');
      return;
    }
    if (action === 'REVIEW_CHANGES') {
      setActiveView('changes');
      return;
    }
    if (action === 'RESOLVE_CONFLICTS') {
      resolveConflicts();
      return;
    }
    if (action === 'CREATE_BRANCH') {
      setActiveView('branches');
      return;
    }
    if (action === 'INITIALIZE_REPOSITORY') {
      clearOperationError();
      void initRepository();
      return;
    }
    clearOperationError();
    refreshAll();
  };

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>Select a project to view source control</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {!gitStatus?.error && (
        <GitPanelHeader
          isMobile={isMobile}
          currentBranch={currentBranch}
          branches={branches}
          remoteStatus={remoteStatus}
          isLoading={isLoading}
          isCreatingBranch={isCreatingBranch}
          isFetching={isFetching}
          isPulling={isPulling}
          isPushing={isPushing}
          isPublishing={isPublishing}
          isRevertingLocalCommit={isRevertingLocalCommit}
          onRefresh={refreshAll}
          onRevertLocalCommit={revertLatestLocalCommit}
          onSwitchBranch={switchBranch}
          onCreateBranch={createBranch}
          onFetch={handleFetch}
          onPull={handlePull}
          onPush={handlePush}
          onPublish={handlePublish}
          onOpenGitSettings={onShowSettings ? () => onShowSettings('git') : undefined}
          onRequestConfirmation={setConfirmAction}
        />
      )}

      {!isMissingRepository && (
        <GitRecoveryBanner
          issue={visibleIssue}
          operation={activeOperation}
          conflicts={conflicts}
          undoState={undoState}
          isContinuingOperation={isContinuingOperation}
          isAbortingOperation={isAbortingOperation}
          isUndoingFileAction={isUndoingFileAction}
          onRecover={recoverFromIssue}
          onResolveConflicts={resolveConflicts}
          onContinueOperation={(operation) => { void continueGitOperation(operation); }}
          onRequestAbort={(operation) => {
            setConfirmAction({
              type: 'abortGitOperation',
              message: `Abort the active ${operation}? Changes made by the ${operation} may be rolled back.`,
              onConfirm: async () => {
                await abortGitOperation(operation);
              },
            });
          }}
          onUndo={() => { void undoLastFileAction(); }}
          onDismissIssue={operationError ? clearOperationError : undefined}
        />
      )}

      {gitStatus?.error ? (
        isMissingRepository ? (
          <GitRepositoryErrorState
            error={gitStatus.error}
            details={gitStatus.details}
            canInitRepository
            isInitializingRepository={isInitializingRepository}
            initError={operationError
              ? `${operationError.error}: ${operationError.details}`
              : null}
            onInitRepository={() => {
              clearOperationError();
              void initRepository();
            }}
          />
        ) : (
          <div className="flex-1" aria-hidden="true" />
        )
      ) : (
        <>
          <GitViewTabs
            activeView={activeView}
            isHidden={hasExpandedFiles}
            changeCount={changeCount}
            onChange={setActiveView}
          />

          {activeView === 'changes' && (
            <ChangesView
              key={selectedProject.fullPath}
              isMobile={isMobile}
              projectId={selectedProject.projectId}
              gitStatus={gitStatus}
              gitDiff={gitDiff}
              remoteStatus={remoteStatus}
              isLoading={isLoading}
              wrapText={wrapText}
              isRecoveryActive={Boolean(activeOperation || visibleIssue)}
              onWrapTextChange={setWrapText}
              onOpenFile={openFile}
              onDiscardFile={discardChanges}
              onDeleteFile={deleteUntrackedFile}
              onStageFiles={stageFiles}
              onUnstageFiles={unstageFiles}
              onCommitChanges={commitChanges}
              onOpenAgentSettings={() => onShowSettings?.('agents')}
              onOpenGitSettings={() => onShowSettings?.('git')}
              onReviewStagedChanges={refreshAll}
              onRequestConfirmation={setConfirmAction}
              onExpandedFilesChange={setHasExpandedFiles}
            />
          )}

          {activeView === 'history' && (
            <HistoryView
              isMobile={isMobile}
              // Treat an in-flight commits request as loading only while the
              // list is empty, so "No commits found" never flashes before the
              // first response and refetches don't blank an existing list.
              isLoading={isLoading || (recentCommits.length === 0 && isLoadingCommits)}
              recentCommits={recentCommits}
              commitDiffs={commitDiffs}
              wrapText={wrapText}
              onFetchCommitDiff={fetchCommitDiff}
            />
          )}

          {activeView === 'worktrees' && (
            <WorktreesView
              key={selectedProject.fullPath}
              isMobile={isMobile}
              selectedProject={selectedProject}
              localBranches={localBranches}
              onProjectSelect={onProjectSelect}
              onProjectsRefresh={onProjectsRefresh}
            />
          )}

          {activeView === 'branches' && (
            <BranchesView
              isMobile={isMobile}
              isLoading={isLoading}
              currentBranch={currentBranch}
              localBranches={localBranches}
              remoteBranches={remoteBranches}
              remoteStatus={remoteStatus}
              isCreatingBranch={isCreatingBranch}
              onSwitchBranch={switchBranch}
              onCreateBranch={createBranch}
              onDeleteBranch={deleteBranch}
              onRequestConfirmation={setConfirmAction}
            />
          )}
        </>
      )}

      <ConfirmActionModal
        action={confirmAction}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          void executeConfirmedAction();
        }}
      />
    </div>
  );
}
