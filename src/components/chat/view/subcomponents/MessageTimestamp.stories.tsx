import type { Meta, StoryObj } from '@storybook/react-vite';

import MessageTimestamp from './MessageTimestamp';

const meta = {
  title: 'Desktop UX/Chat/Message timestamp',
  component: MessageTimestamp,
  parameters: { layout: 'centered' },
  args: {
    timestamp: '2026-08-16T10:02:00.000Z',
    className: 'text-xs',
  },
} satisfies Meta<typeof MessageTimestamp>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LocalTime: Story = {};

export const InvalidTimestampHidden: Story = {
  args: { timestamp: 'not-a-date' },
};
