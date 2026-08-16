import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (filePath: string) => readFile(filePath, 'utf8');

test('Schedules uses a catalog-backed main workspace with progressive timing', async () => {
  const [workspace, app, context] = await Promise.all([
    read('src/components/scheduled-runs/ScheduleEditorWorkspace.tsx'),
    read('src/components/app/AppContent.tsx'),
    read('src/contexts/ScheduledRunsContext.tsx'),
  ]);
  await assert.rejects(access('src/components/scheduled-runs/modals/ScheduleEditorModal.tsx'));
  assert.match(workspace, /Daily/);
  assert.match(workspace, /Weekly/);
  assert.match(workspace, /Custom time/);
  assert.match(workspace, /Advanced/);
  assert.match(workspace, /Cron expression/);
  assert.match(workspace, /nextCronRuns/);
  assert.match(workspace, /useProviderSelectionCatalog/);
  assert.match(workspace, /providerProfileId/);
  assert.match(workspace, /Desktop or the local server must be running/);
  assert.doesNotMatch(workspace, /label="Project path"|projectPath:\s*project/);
  assert.doesNotMatch(app, /schedule-workspace:(create|edit)/);
  assert.match(context, /stageRemove/);
  assert.match(context, /undoRemove/);
});

test('scheduler records startup downtime as Missed and never invokes an initial replay tick', async () => {
  const scheduler = await read('server/modules/scheduled-runs/scheduler.service.ts');
  assert.match(scheduler, /markStartupMisses\(/);
  assert.match(scheduler, /'missed'/);
  assert.match(scheduler, /not replayed/i);
  assert.doesNotMatch(scheduler, /markStartupMisses\([^;]*\);\s*(?:void\s+)?tick\(\)/);
});
