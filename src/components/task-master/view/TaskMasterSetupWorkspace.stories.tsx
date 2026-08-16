import type { ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import TaskMasterSetupWorkspace from './TaskMasterSetupWorkspace';

const setupApi: NonNullable<ComponentProps<typeof TaskMasterSetupWorkspace>['setupApi']> = {
  analyze: async () => ({
    attemptId: 'setup-attempt-1',
    before: { status: 'partial', missing: ['.taskmaster/config.json'], invalid: [] },
    operations: [
      {
        path: '.taskmaster/config.json',
        action: 'create',
        description: 'Create the canonical TaskMaster project configuration.',
        source: 'generated',
      },
      {
        path: 'CLAUDE.md',
        action: 'merge',
        description: 'Add the TaskMaster instruction import without replacing existing content.',
        source: 'reference',
      },
    ],
    modelDefaults: { main: 'keep-current-default' },
    changesExistingModelDefaults: false,
    repair: false,
  }),
  apply: async (_projectId, _attemptId, options) => {
    options?.onProgress?.({ stage: 'backup', message: 'Backing up project files', completed: 1, total: 6 });
    return {
      after: { status: 'valid', missing: [], invalid: [] },
      added: ['.taskmaster/config.json'],
      replaced: [],
      merged: ['CLAUDE.md'],
      rollbackPerformed: false,
    };
  },
  cancel: async () => true,
};

const meta = {
  title: 'Desktop UX/Tasks/Setup workspace',
  component: TaskMasterSetupWorkspace,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="min-h-screen bg-background"><Story /></div>],
  args: {
    project: {
      projectId: 'project-1',
      displayName: 'CloudCLI Desktop',
      fullPath: '/Users/example/CloudCLI',
    },
    onCancel: () => undefined,
    onComplete: () => undefined,
    setupApi,
  },
} satisfies Meta<typeof TaskMasterSetupWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnalyzeThenPreview: Story = {};
