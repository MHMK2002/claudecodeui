import type { Meta, StoryObj } from '@storybook/react-vite';

import { createCommitMessageSuggestionState } from '../../hooks/useCommitMessageSuggestion';
import type {
  CommitMessageSuggestionController,
  CommitMessageSuggestionState,
} from '../../types/types';

import CommitComposer from './CommitComposer';

const noOp = () => undefined;
const selection = { provider: 'codex' as const, providerProfileId: 12, model: 'gpt-5.4' };
const analysis = {
  totalStagedFiles: 3,
  sampledFiles: 3,
  recentSubjects: 12,
  truncated: false,
};

function controller(
  state: CommitMessageSuggestionState,
  overrides: Partial<CommitMessageSuggestionController> = {},
): CommitMessageSuggestionController {
  const isBusy = state.status === 'checking-provider' || state.status === 'generating';
  return {
    state,
    selectedProvider: 'codex',
    selectedProviderLabel: 'Codex',
    isBusy,
    canGenerate: !isBusy,
    generateDisabledReason: null,
    commitSnapshotId: state.snapshotId,
    isCommitBlockedByStaleSuggestion: state.status === 'stale',
    setMessage: noOp,
    generate: noOp,
    cancel: noOp,
    retry: noOp,
    useSuggestion: noOp,
    dismissSuggestion: noOp,
    updateSuggestion: noOp,
    keepCurrentMessage: noOp,
    invalidateForCommit: noOp,
    markCommitConflict: noOp,
    clearAfterCommit: noOp,
    ...overrides,
  };
}

const meta = {
  title: 'Desktop UX/Source Control/Commit composer',
  component: CommitComposer,
  parameters: { layout: 'fullscreen' },
  args: {
    isMobile: false,
    selectedFileCount: 3,
    hasPendingStageOperations: false,
    isHidden: false,
    suggestion: controller(createCommitMessageSuggestionState()),
    onCommit: async () => ({ success: true }),
    onOpenAgentSettings: noOp,
    onReviewStagedChanges: noOp,
    onRequestConfirmation: noOp,
  },
} satisfies Meta<typeof CommitComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: {
    selectedFileCount: 0,
    suggestion: controller(createCommitMessageSuggestionState(), {
      canGenerate: false,
      generateDisabledReason: 'Stage at least one file to generate a message.',
    }),
  },
};

export const Ready: Story = {
  args: {
    suggestion: controller(createCommitMessageSuggestionState('feat(git): improve staging feedback')),
  },
};

export const Generating: Story = {
  args: {
    suggestion: controller({
      ...createCommitMessageSuggestionState(),
      status: 'generating',
      requestId: 1,
      requestProjectId: 'project-1',
      requestStagedKey: 'a.ts\0b.ts\0c.ts',
      requestDraftRevision: 0,
      requestStartedMessage: '',
      requestMode: 'generate',
    }),
  },
};

export const ProtectedInputSuggestion: Story = {
  args: {
    suggestion: controller({
      ...createCommitMessageSuggestionState('manual message kept intact'),
      status: 'suggestion',
      candidate: {
        message: 'feat(git): generate a bounded staged suggestion',
        snapshotId: 'a'.repeat(64),
        stagedKey: 'a.ts\0b.ts\0c.ts',
        selection,
        analysis: { ...analysis, truncated: true, sampledFiles: 2 },
      },
    }),
  },
};

export const StaleGeneratedDraft: Story = {
  args: {
    suggestion: controller({
      ...createCommitMessageSuggestionState('feat(git): old staged suggestion'),
      status: 'stale',
      provenance: 'generated',
      snapshotId: 'b'.repeat(64),
      generatedMessage: 'feat(git): old staged suggestion',
      generatedStagedKey: 'old.ts',
      selection,
      analysis,
    }),
  },
};

export const ProviderFailure: Story = {
  args: {
    suggestion: controller({
      ...createCommitMessageSuggestionState('manual draft remains editable'),
      status: 'error',
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        error: 'Codex is unavailable.',
        details: 'Connect or repair Codex in Agent Settings.',
        action: 'OPEN_AGENT_SETTINGS',
      },
    }),
  },
};

export const MobileCollapsed: Story = {
  args: {
    isMobile: true,
    suggestion: controller(createCommitMessageSuggestionState()),
  },
  decorators: [(StoryComponent) => (
    <div style={{ width: 320, minHeight: 720 }}>
      <StoryComponent />
    </div>
  )],
};
