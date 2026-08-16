import type { Meta, StoryObj } from '@storybook/react-vite';

import GitRecoveryBanner from './GitRecoveryBanner';

const meta = {
  title: 'Desktop UX/Source Control/Recovery banner',
  component: GitRecoveryBanner,
  parameters: { layout: 'fullscreen' },
  args: {
    issue: {
      code: 'NETWORK_OFFLINE',
      error: 'Network unavailable',
      details: 'Reconnect to the network before retrying the Git operation.',
      action: 'RETRY',
    },
    operation: null,
    conflicts: [],
    undoState: null,
    isContinuingOperation: false,
    isAbortingOperation: false,
    isUndoingFileAction: false,
    onRecover: () => undefined,
    onResolveConflicts: () => undefined,
    onContinueOperation: () => undefined,
    onRequestAbort: () => undefined,
    onUndo: () => undefined,
    onDismissIssue: () => undefined,
  },
} satisfies Meta<typeof GitRecoveryBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NetworkRecovery: Story = {};

export const MergeConflicts: Story = {
  args: {
    issue: null,
    operation: 'merge',
    conflicts: ['src/App.tsx', 'server/index.ts'],
  },
};

export const UndoAvailable: Story = {
  args: {
    issue: null,
    undoState: { token: 'undo-1', message: 'Discarded changes from src/App.tsx.' },
  },
};
