import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ScheduledRunPersistenceCreateInput,
  ScheduledRunRecord,
} from '@/shared/types.js';

import { createScheduledRunsService } from '../scheduled-runs.service.js';

test('create resolves canonical project path and validates the full catalog selection', async () => {
  const persistedInputs: ScheduledRunPersistenceCreateInput[] = [];
  const validatedSelections: Record<string, unknown>[] = [];
  const service = createScheduledRunsService({
    repository: {
      list: () => [],
      getById: () => null,
      create: (userId, input) => {
        persistedInputs.push(input);
        return {
          id: 1,
          userId,
          lastRunAt: null,
          inFlightRunId: null,
          createdAt: '2026-08-16T00:00:00.000Z',
          updatedAt: '2026-08-16T00:00:00.000Z',
          notifyChannels: null,
          ...input,
        } as ScheduledRunRecord;
      },
      update: () => null,
      delete: () => false,
      setEnabled: () => null,
      listHistory: () => [],
    },
    projects: {
      getProjectById: (projectId) => ({
        project_id: projectId,
        project_path: '/canonical/project',
        custom_project_name: null,
        isStarred: 0,
        isArchived: 0,
      }),
      getProjectPath: () => null,
    },
    providerSelection: {
      validateSelection: async (selection) => { validatedSelections.push(selection); },
    },
    broadcastChanged: () => undefined,
    triggerRun: async () => ({ runId: 1 }),
    now: () => new Date('2026-08-16T10:00:00.000Z'),
  });

  const created = await service.create(7, {
    title: ' Daily review ',
    projectId: 'project-1',
    provider: 'codex',
    providerProfileId: 9,
    model: 'gpt-test',
    prompt: ' Review the project ',
    cronExpression: '0 8 * * *',
    timezone: 'UTC',
    notifyOnSuccess: false,
    notifyOnFailure: true,
    notifyChannels: null,
    isEnabled: true,
  });

  assert.deepEqual(validatedSelections[0], {
    userId: 7,
    provider: 'codex',
    providerProfileId: 9,
    model: 'gpt-test',
  });
  const persisted = persistedInputs[0];
  assert.ok(persisted);
  assert.equal(persisted.projectPath, '/canonical/project');
  assert.equal(persisted.projectId, 'project-1');
  assert.ok(new Date(persisted.nextRunAt).getTime() > new Date('2026-08-16T10:00:00.000Z').getTime());
  assert.equal(created.title, 'Daily review');
  assert.equal(created.prompt, 'Review the project');
});
