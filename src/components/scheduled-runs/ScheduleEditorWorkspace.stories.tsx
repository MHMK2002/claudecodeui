import type { Meta, StoryObj } from '@storybook/react-vite';

import type { ProviderSelectionCatalogState } from '../../shared/hooks/useProviderSelectionCatalog';
import type { ProviderSelectionCatalog } from '../../types/app';

import { ScheduleEditorWorkspaceView } from './ScheduleEditorWorkspace';

const catalog: ProviderSelectionCatalog = {
  providers: [
    {
      provider: 'claude',
      available: true,
      connectionAvailable: false,
      unavailableReason: null,
      profiles: [{ id: 1, title: 'Local Claude', isDefault: true }],
      models: {
        DEFAULT: 'claude-sonnet-4-5',
        OPTIONS: [{ value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }],
      },
    },
    {
      provider: 'codex',
      available: false,
      connectionAvailable: false,
      unavailableReason: 'Connect a Codex profile in Agent Settings.',
      profiles: [],
      models: { DEFAULT: 'gpt-5.4', OPTIONS: [{ value: 'gpt-5.4', label: 'GPT-5.4' }] },
    },
  ],
};

const catalogState: ProviderSelectionCatalogState = {
  catalog,
  loading: false,
  error: null,
  reload: () => undefined,
  getEntry: (provider) => catalog.providers.find((entry) => entry.provider === provider) ?? null,
  listAvailable: () => catalog.providers.filter((entry) => entry.available),
};

const meta = {
  title: 'Desktop UX/Schedules/Editor workspace',
  component: ScheduleEditorWorkspaceView,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="min-h-screen bg-background"><Story /></div>],
  args: {
    project: {
      projectId: 'project-1',
      displayName: 'CloudCLI Desktop',
      fullPath: '/Users/example/CloudCLI',
    },
    editingSchedule: null,
    onClose: () => undefined,
    onOpenAgentSettings: () => undefined,
    scheduleActions: {
      create: async () => { throw new Error('Story fixture does not persist schedules.'); },
      update: async () => { throw new Error('Story fixture does not persist schedules.'); },
      runNow: async () => ({ runId: 1 }),
    },
    catalogState,
  },
} satisfies Meta<typeof ScheduleEditorWorkspaceView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewLocalSchedule: Story = {};
