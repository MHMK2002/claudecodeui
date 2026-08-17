import type { Meta, StoryObj } from '@storybook/react-vite';

import { ToolExecutionMeta } from './ToolExecutionMeta';

const meta = {
  title: 'Desktop UX/Chat/Tool execution metadata',
  component: ToolExecutionMeta,
  parameters: { layout: 'centered' },
  args: {
    status: 'running',
    timestamp: '2026-08-16T10:02:00.000Z',
  },
} satisfies Meta<typeof ToolExecutionMeta>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  render: (args) => (
    <div className="flex w-[min(42rem,calc(100vw-2rem))] flex-wrap items-center gap-x-1.5 gap-y-1 border-l-2 border-blue-500 py-1 pl-3 text-xs">
      <span className="shrink-0 font-medium text-muted-foreground">File Change</span>
      <span className="shrink-0 text-muted-foreground">/</span>
      <span className="min-w-0 flex-1 truncate font-mono text-primary">
        src/components/chat/MessageComponent.tsx
      </span>
      <ToolExecutionMeta {...args} className="ml-auto" />
    </div>
  ),
};

export const Completed: Story = {
  args: { status: undefined },
};

export const Error: Story = {
  args: { status: 'error' },
};

export const Denied: Story = {
  args: { status: 'denied' },
};

export const NarrowHeader: Story = {
  ...Running,
  parameters: {
    layout: 'centered',
    viewport: { defaultViewport: 'mobile1' },
  },
};
