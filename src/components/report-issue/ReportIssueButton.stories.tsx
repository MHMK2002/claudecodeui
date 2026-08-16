import type { Meta, StoryObj } from '@storybook/react-vite';

import ReportIssueButton from './ReportIssueButton';

const meta = {
  title: 'Desktop UX/System/Report issue',
  component: ReportIssueButton,
  parameters: { layout: 'centered' },
  args: {
    children: 'Report Issue',
    label: 'Report Issue',
    issueTrackerUrl: 'https://github.com/cloud-cli/cloudcli/issues',
    className: 'min-h-11 rounded-lg border border-border bg-background px-4 py-2 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  },
} satisfies Meta<typeof ReportIssueButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PreviewBeforeExternalNavigation: Story = {};

export const HiddenWithoutTracker: Story = {
  args: { issueTrackerUrl: null },
};
