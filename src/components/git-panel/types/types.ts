import type {
  LLMProvider,
  Project,
  ResolvedProviderSelection,
} from '../../../types/app';
import type { SettingsMainTab } from '../../settings/types/types';

export type GitPanelView = 'changes' | 'history' | 'branches' | 'worktrees';
export type FileStatusCode = 'M' | 'A' | 'D' | 'U' | 'C';
export type GitStatusFileGroup = 'modified' | 'added' | 'deleted' | 'untracked';
export type ConfirmActionType = 'discard' | 'delete' | 'commit' | 'pull' | 'push' | 'publish' | 'revertLocalCommit' | 'deleteBranch' | 'abortGitOperation';

export type GitIssueCode =
  | 'GIT_MISSING'
  | 'NOT_A_GIT_REPOSITORY'
  | 'NO_REMOTE'
  | 'AUTH_FAILED'
  | 'NETWORK_OFFLINE'
  | 'DETACHED_HEAD'
  | 'DIRTY_BRANCH_SWITCH'
  | 'MERGE_CONFLICT'
  | 'REBASE_CONFLICT'
  | 'PERMISSION_DENIED'
  | 'UNDO_UNAVAILABLE'
  | 'GIT_OPERATION_FAILED';

export type CommitMessageGenerationErrorCode =
  | 'INVALID_GENERATION_REQUEST'
  | 'TOO_MANY_STAGED_FILES'
  | 'NO_STAGED_CHANGES'
  | 'STAGED_CHANGES_CHANGED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_PROFILE_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE'
  | 'PROVIDER_UNSUPPORTED_FOR_GENERATION'
  | 'GENERATION_FAILED'
  | 'INVALID_GENERATED_MESSAGE'
  | 'GENERATION_TIMEOUT';

export type CommitMessageGenerationRecoveryAction =
  | 'OPEN_AGENT_SETTINGS'
  | 'RETRY'
  | 'REVIEW_STAGED_CHANGES';

export type CommitMessageGenerationAnalysis = {
  totalStagedFiles: number;
  sampledFiles: number;
  recentSubjects: number;
  truncated: boolean;
};

export type CommitMessageGenerationError = {
  code: CommitMessageGenerationErrorCode;
  error: string;
  details: string;
  action: CommitMessageGenerationRecoveryAction;
};

export type CommitMessageGenerationResponse = {
  success: true;
  message: string;
  snapshotId: string;
  selection: ResolvedProviderSelection;
  analysis: CommitMessageGenerationAnalysis;
};

export type CommitMessageGenerationFailureResponse = {
  success: false;
  code?: CommitMessageGenerationErrorCode;
  error?: string;
  details?: string;
  action?: CommitMessageGenerationRecoveryAction;
};

export type CommitMessageSuggestionStatus =
  | 'idle'
  | 'checking-provider'
  | 'generating'
  | 'applied'
  | 'suggestion'
  | 'stale'
  | 'manual'
  | 'error'
  | 'cancelled';

export type CommitMessageDraftProvenance = 'manual' | 'generated';

export type CommitMessageSuggestionCandidate = {
  message: string;
  snapshotId: string;
  stagedKey: string;
  selection: ResolvedProviderSelection;
  analysis: CommitMessageGenerationAnalysis;
};

export type CommitMessageSuggestionState = {
  status: CommitMessageSuggestionStatus;
  message: string;
  draftRevision: number;
  provenance: CommitMessageDraftProvenance;
  snapshotId: string | null;
  generatedMessage: string | null;
  generatedStagedKey: string | null;
  selection: ResolvedProviderSelection | null;
  analysis: CommitMessageGenerationAnalysis | null;
  candidate: CommitMessageSuggestionCandidate | null;
  error: CommitMessageGenerationError | null;
  requestId: number | null;
  requestProjectId: string | null;
  requestStagedKey: string | null;
  requestDraftRevision: number | null;
  requestStartedMessage: string | null;
  requestMode: 'generate' | 'update' | null;
};

export type CommitMessageDraftCacheEntry = Pick<
  CommitMessageSuggestionState,
  | 'status'
  | 'message'
  | 'draftRevision'
  | 'provenance'
  | 'snapshotId'
  | 'generatedMessage'
  | 'generatedStagedKey'
  | 'selection'
  | 'analysis'
>;

export type CommitMessageSuggestionController = {
  state: CommitMessageSuggestionState;
  selectedProvider: LLMProvider;
  selectedProviderLabel: string;
  isBusy: boolean;
  canGenerate: boolean;
  generateDisabledReason: string | null;
  commitSnapshotId: string | null;
  isCommitBlockedByStaleSuggestion: boolean;
  setMessage(message: string): void;
  generate(): void;
  cancel(): void;
  retry(): void;
  useSuggestion(): void;
  dismissSuggestion(): void;
  updateSuggestion(): void;
  keepCurrentMessage(): void;
  invalidateForCommit(): void;
  markCommitConflict(): void;
  clearAfterCommit(): void;
};

export type GitRecoveryAction =
  | 'INSTALL_GIT'
  | 'INITIALIZE_REPOSITORY'
  | 'OPEN_GIT_SETTINGS'
  | 'RETRY'
  | 'REVIEW_CHANGES'
  | 'RESOLVE_CONFLICTS'
  | 'CREATE_BRANCH';

export type GitOperationIssue = {
  code: GitIssueCode;
  error: string;
  details: string;
  action: GitRecoveryAction;
};

export type FileDiffInfo = {
  old_string: string;
  new_string: string;
};

export type FileOpenHandler = (filePath: string, diffInfo?: FileDiffInfo) => void;

export type GitPanelProps = {
  selectedProject: Project | null;
  isMobile?: boolean;
  onFileOpen?: FileOpenHandler;
  /** Switches the app to another project — used by the Worktrees view to jump into a worktree. */
  onProjectSelect?: (project: Project) => void;
  /** Silently re-syncs the sidebar project list after worktree projects are created/archived. */
  onProjectsRefresh?: () => void;
  /** Opens Settings for Git credential/remote recovery. */
  onShowSettings?: (tab?: SettingsMainTab) => void;
};

export type GitStatusResponse = {
  branch?: string;
  detachedHead?: boolean;
  hasCommits?: boolean;
  modified?: string[];
  added?: string[];
  deleted?: string[];
  untracked?: string[];
  /** Paths with index-side changes — mirrors the real git index. */
  staged?: string[];
  conflicts?: string[];
  operation?: 'merge' | 'rebase' | null;
  error?: string;
  details?: string;
  code?: GitIssueCode;
  action?: GitRecoveryAction;
  /** True when the project directory is not a git repository — the UI offers `git init`. */
  notGitRepository?: boolean;
};

export type GitRemoteStatus = {
  hasRemote?: boolean;
  hasUpstream?: boolean;
  branch?: string;
  remoteBranch?: string;
  remoteName?: string | null;
  ahead?: number;
  behind?: number;
  isUpToDate?: boolean;
  message?: string;
  error?: string;
};

export type GitCommitSummary = {
  hash: string;
  author: string;
  email?: string;
  date: string;
  message: string;
  stats?: string;
  /** Parent commit hashes — drives the History view commit graph. */
  parents?: string[];
  /** Ref decorations, e.g. "HEAD -> main", "origin/main", "tag: v1.0". */
  refs?: string[];
};

export type GitDiffMap = Record<string, string>;

export type GitStatusGroupEntry = {
  key: GitStatusFileGroup;
  status: FileStatusCode;
};

export type ConfirmationRequest = {
  type: ConfirmActionType;
  message: string;
  onConfirm: () => Promise<void> | void;
};

export type UseGitPanelControllerOptions = {
  selectedProject: Project | null;
  activeView: GitPanelView;
  onFileOpen?: FileOpenHandler;
};

export type GitPanelController = {
  gitStatus: GitStatusResponse | null;
  gitDiff: GitDiffMap;
  isLoading: boolean;
  isLoadingCommits: boolean;
  currentBranch: string;
  branches: string[];
  localBranches: string[];
  remoteBranches: string[];
  recentCommits: GitCommitSummary[];
  commitDiffs: GitDiffMap;
  remoteStatus: GitRemoteStatus | null;
  isCreatingBranch: boolean;
  isFetching: boolean;
  isPulling: boolean;
  isPushing: boolean;
  isPublishing: boolean;
  isInitializingRepository: boolean;
  isContinuingOperation: boolean;
  isAbortingOperation: boolean;
  isUndoingFileAction: boolean;
  operationError: GitOperationIssue | null;
  undoState: { token: string; message: string } | null;
  clearOperationError: () => void;
  refreshAll: () => void;
  switchBranch: (branchName: string) => Promise<boolean>;
  createBranch: (branchName: string) => Promise<boolean>;
  deleteBranch: (branchName: string) => Promise<boolean>;
  handleFetch: () => Promise<void>;
  handlePull: () => Promise<void>;
  handlePush: () => Promise<void>;
  handlePublish: () => Promise<void>;
  continueGitOperation: (operation: 'merge' | 'rebase') => Promise<boolean>;
  abortGitOperation: (operation: 'merge' | 'rebase') => Promise<boolean>;
  discardChanges: (filePath: string) => Promise<void>;
  deleteUntrackedFile: (filePath: string) => Promise<void>;
  undoLastFileAction: () => Promise<boolean>;
  stageFiles: (files: string[]) => Promise<boolean>;
  unstageFiles: (files: string[]) => Promise<boolean>;
  fetchCommitDiff: (commitHash: string) => Promise<void>;
  commitChanges: (
    message: string,
    files: string[],
    expectedSnapshotId?: string,
  ) => Promise<GitCommitResult>;
  initRepository: () => Promise<boolean>;
  openFile: (filePath: string) => Promise<void>;
};

export type GitApiErrorResponse = {
  error?: string;
  details?: string;
  code?: GitIssueCode;
  action?: GitRecoveryAction;
};

export type GitDiffResponse = GitApiErrorResponse & {
  diff?: string;
};

export type GitBranchesResponse = GitApiErrorResponse & {
  branches?: string[];
  localBranches?: string[];
  remoteBranches?: string[];
};

export type GitCommitsResponse = GitApiErrorResponse & {
  commits?: GitCommitSummary[];
};

export type GitOperationResponse = GitApiErrorResponse & {
  success?: boolean;
  output?: string;
  undoToken?: string | null;
};

export type GitCommitResult = {
  success: boolean;
  code?: GitIssueCode | 'STAGED_CHANGES_CHANGED';
  error?: string;
  details?: string;
  action?: GitRecoveryAction | 'REVIEW_STAGED_CHANGES';
};

export type GitFileWithDiffResponse = GitApiErrorResponse & {
  oldContent?: string;
  currentContent?: string;
  isDeleted?: boolean;
  isUntracked?: boolean;
};

// ---------------------------------------------------------------------------
// Worktrees — mirrors the /api/worktrees payloads (server/shared/types.ts)
// ---------------------------------------------------------------------------

export type WorktreeInfo = {
  path: string;
  branch: string | null;
  headSha: string | null;
  isMain: boolean;
  isCurrent: boolean;
  isLocked: boolean;
  isDetached: boolean;
  changedFileCount: number;
  ahead: number;
  behind: number;
  lastCommitSubject: string | null;
  lastCommitDate: string | null;
  linkedProjectId: string | null;
  linkedProjectArchived: boolean;
};

export type WorktreeListData = {
  repositoryRoot: string;
  /** Branch checked out in the main worktree — the merge target. */
  baseBranch: string | null;
  worktrees: WorktreeInfo[];
};

/** `/api/worktrees` uses the shared `{ success, data | error }` envelope. */
export type WorktreeApiEnvelope<TData> = {
  success?: boolean;
  data?: TData;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export type MergeWorktreeOptions = {
  squash: boolean;
  message: string;
  removeAfterMerge: boolean;
};

export type RemoveWorktreeOptions = {
  force: boolean;
  deleteBranch: boolean;
};
