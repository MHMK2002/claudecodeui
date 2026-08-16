import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TaskEmptyState from './view/TaskEmptyState.js';
import TaskMasterSetupWorkspace from './view/TaskMasterSetupWorkspace.js';

const read = (filePath: string) => readFile(filePath, 'utf8');
const project = {
  projectId: 'project-1',
  displayName: 'Local Project',
  fullPath: '/workspace/project',
};

test('project drawer has one persisted docked implementation with no backdrop', async () => {
  const [drawer, drawerState, app] = await Promise.all([
    read('src/components/quick-settings-panel/view/QuickSettingsPanelView.tsx'),
    read('src/components/quick-settings-panel/hooks/useProjectDrawerState.ts'),
    read('src/components/app/AppContent.tsx'),
  ]);
  await assert.rejects(access('src/components/scheduled-runs/panel/RightSidebar.tsx'));
  assert.doesNotMatch(drawer, /backdrop-blur|fixed inset-0.*bg-/);
  assert.match(drawer, /relative shrink-0/);
  assert.match(drawer, /role="separator"/);
  assert.match(drawerState, /isOpen.*activeTab.*width/s);
  assert.match(drawerState, /localStorage\.setItem/);
  assert.equal((app.match(/<QuickSettingsPanel/g) ?? []).length, 1);
});

test('Task setup is a workspace wizard with one Analyze primary action', () => {
  const markup = renderToStaticMarkup(
    <TaskMasterSetupWorkspace project={project} onCancel={() => undefined} onComplete={() => undefined} />,
  );
  assert.match(markup, /Set up Tasks for Local Project/);
  assert.match(markup, />Analyze</);
  assert.match(markup, /Preview/);
  assert.match(markup, /Confirm/);
  assert.doesNotMatch(markup, /role="dialog"|npx task-master init/);
  assert.equal((markup.match(/\sbg-primary\s/g) ?? []).length, 1);
});

test('Task board empty states own one exact primary CTA', () => {
  const uninitialized = renderToStaticMarkup(
    <TaskEmptyState
      hasTaskMasterDirectory={false}
      existingPrds={[]}
      onOpenSetupModal={() => undefined}
      onCreatePrd={() => undefined}
      onCreateTask={() => undefined}
      onOpenPrd={() => undefined}
    />,
  );
  assert.match(uninitialized, />Set up Tasks</);
  assert.equal((uninitialized.match(/\sbg-primary\s/g) ?? []).length, 1);

  const empty = renderToStaticMarkup(
    <TaskEmptyState
      hasTaskMasterDirectory
      existingPrds={[]}
      onOpenSetupModal={() => undefined}
      onCreatePrd={() => undefined}
      onCreateTask={() => undefined}
      onOpenPrd={() => undefined}
    />,
  );
  assert.match(empty, />Create task</);
  assert.equal((empty.match(/\sbg-primary\s/g) ?? []).length, 1);
});

test('canonical initializer is TypeScript, backed up, locked, idempotent, and never silently changes models', async () => {
  const [initializer, routes, board, workflow] = await Promise.all([
    read('server/modules/taskmaster/taskmaster-initializer.service.ts'),
    read('server/modules/taskmaster/taskmaster.routes.ts'),
    read('src/components/task-master/view/TaskBoardContent.tsx'),
    read('src/components/task-master/workflow.ts'),
  ]);
  await assert.rejects(access('server/modules/taskmaster/taskmaster-initializer.service.js'));
  await assert.rejects(access('src/components/task-master/view/modals/TaskMasterSetupModal.tsx'));
  await assert.rejects(access('src/components/task-master/view/modals/CreateTaskModal.tsx'));
  assert.match(initializer, /createBackup/);
  assert.match(initializer, /projectLocks/);
  assert.match(initializer, /attempt\.result/);
  assert.match(initializer, /changesExistingModelDefaults: false/);
  assert.doesNotMatch(initializer, /models', '--set-|configureModels/);
  assert.doesNotMatch(routes, /\['task-master', 'init'\]/);
  assert.match(board, /Clear filters/);
  assert.match(workflow, /stage: 'provider'/);
  assert.match(workflow, /stage: 'delivery'/);
  assert.match(workflow, /signal\?\.throwIfAborted/);
});
