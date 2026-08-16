import type { Meta, StoryObj } from '@storybook/react-vite';
import { Download, FileText, Trash2 } from 'lucide-react';

import ActionMenu from './ActionMenu';

const meta = {
  title: 'Shared/ActionMenu',
  component: ActionMenu,
  parameters: { layout: 'centered' },
  args: {
    label: 'Export',
    ariaLabel: 'Export session',
    items: [
      { key: 'markdown', label: 'Markdown', description: 'Portable plain text', icon: FileText, onSelect: () => undefined },
      { key: 'download', label: 'Download archive', icon: Download, onSelect: () => undefined },
      { key: 'remove', label: 'Delete export', icon: Trash2, isDanger: true, showDividerBefore: true, onSelect: () => undefined },
    ],
  },
} satisfies Meta<typeof ActionMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const IconOnly: Story = {
  args: {
    icon: Download,
    iconOnly: true,
  },
};
