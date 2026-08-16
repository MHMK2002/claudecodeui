import type { ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import TaskIntakeWorkspace from './TaskIntakeWorkspace';

const workflowApi: NonNullable<ComponentProps<typeof TaskIntakeWorkspace>['workflowApi']> = {
  list: async () => [{
    id: 'intake-1',
    status: 'ready',
    brief: 'Add a safe Desktop repair flow',
    proposal: {
      intakeId: 'intake-1',
      title: 'Add Desktop repair flow',
      description: 'Detect a build mismatch and recover the bundled local server.',
      details: 'Keep diagnostics secondary and do not expose local secrets.',
      testStrategy: 'Cover compatible, mismatch, repair, and failure states.',
      priority: 'high',
      dependencies: [],
      subtasks: [],
      clarificationAnswers: [],
      acceptedDecisions: [],
      acceptanceCriteria: ['Repair returns to the local workspace.'],
      unresolvedQuestions: [],
      projectMetadata: {},
      taskMetadata: {},
    },
    proposalHash: 'proposal-hash',
    proposalReady: true,
    proposalError: null,
    approvalStatus: null,
    taskId: null,
    createdAt: '2026-08-16T08:00:00.000Z',
  }],
  start: async () => { throw new Error('Story fixture does not start provider sessions.'); },
  approve: async () => { throw new Error('Story fixture does not persist tasks.'); },
};

const meta = {
  title: 'Desktop UX/Tasks/Intake workspace',
  component: TaskIntakeWorkspace,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="min-h-screen bg-background"><Story /></div>],
  args: {
    project: {
      projectId: 'project-1',
      displayName: 'CloudCLI Desktop',
      fullPath: '/Users/example/CloudCLI',
    },
    onCancel: () => undefined,
    onTaskCreated: () => undefined,
    onOpenAgentSettings: () => undefined,
    sendMessage: () => ({ ok: true }),
    workflowApi,
  },
} satisfies Meta<typeof TaskIntakeWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ClarifiedProposalReady: Story = {};
