import type { Meta, StoryObj } from '@storybook/react-vite';

import FileTreeErrorState from './FileTreeErrorState';

const meta = {
  title: 'Desktop UX/Files/Error state',
  component: FileTreeErrorState,
  parameters: { layout: 'centered' },
  args: {
    status: 'server-error',
    message: 'The local server could not load this folder. Your project is still registered.',
    onRetry: () => undefined,
  },
} satisfies Meta<typeof FileTreeErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ServerUnavailable: Story = {};

export const PermissionRequired: Story = {
  args: {
    status: 'permission-error',
    message: 'CloudCLI no longer has permission to read this folder.',
  },
};
