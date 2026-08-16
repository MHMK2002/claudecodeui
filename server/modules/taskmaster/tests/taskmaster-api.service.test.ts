import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { TaskmasterApiError, createTaskmasterApiService } from '../taskmaster-api.service.js';

type Dependencies = Parameters<typeof createTaskmasterApiService>[0];

function createDependencies(
  projectPath: string,
  overrides: Partial<Dependencies> = {},
): Dependencies {
  return {
    fileSystem: fs,
    fileSystemPromises: fsPromises,
    spawnProcess: (() => { throw new Error('spawn should not run'); }) as unknown as Dependencies['spawnProcess'],
    resolveProjectPathById: () => projectPath,
    taskmasterStatusService: {
      detectMcpServer: async () => ({ hasMCPServer: false, reason: 'Not configured', hasConfig: false }),
    } as Dependencies['taskmasterStatusService'],
    taskmasterInitializer: {} as Dependencies['taskmasterInitializer'],
    taskmasterWorkflow: {
      getTaskWorkflowSummary: async () => ({}),
    } as Dependencies['taskmasterWorkflow'],
    ...overrides,
  };
}

test('loadTasks owns project resolution, filesystem parsing, and workflow hydration', async () => {
  const projectPath = await fsPromises.mkdtemp(path.join(tmpdir(), 'taskmaster-api-tasks-'));
  const tasksDirectory = path.join(projectPath, '.taskmaster', 'tasks');
  await fsPromises.mkdir(tasksDirectory, { recursive: true });
  await fsPromises.writeFile(path.join(tasksDirectory, 'tasks.json'), JSON.stringify({
    master: {
      tasks: [{ id: 12, title: 'Ship desktop UX', status: 'in-progress' }],
    },
  }));
  const resolvedIds: string[] = [];
  const service = createTaskmasterApiService(createDependencies(projectPath, {
    resolveProjectPathById: (projectId) => {
      resolvedIds.push(projectId);
      return projectPath;
    },
    taskmasterWorkflow: {
      getTaskWorkflowSummary: async () => ({
        '12': { implementationSessionId: 'session-12' },
      }),
    } as unknown as Dependencies['taskmasterWorkflow'],
  }));

  try {
    const result = await service.loadTasks('project-12');
    assert.deepEqual(resolvedIds, ['project-12']);
    assert.equal(result.projectPath, projectPath);
    assert.equal(result.totalTasks, 1);
    assert.equal(result.tasksByStatus['in-progress'], 1);
    assert.equal(result.tasks[0]?.implementationSessionId, 'session-12');
  } finally {
    await fsPromises.rm(projectPath, { recursive: true, force: true });
  }
});

test('initialization orchestration resolves the canonical project and strips its path from previews', async () => {
  const analyzedPaths: string[] = [];
  const service = createTaskmasterApiService(createDependencies('/canonical/project', {
    taskmasterInitializer: {
      analyze: async (projectPath: string) => {
        analyzedPaths.push(projectPath);
        return {
          attemptId: 'attempt-1',
          projectPath,
          before: { status: 'missing', missing: ['.taskmaster'], invalid: [] },
          operations: [],
          modelDefaults: null,
          changesExistingModelDefaults: false,
          repair: false,
        };
      },
    } as unknown as Dependencies['taskmasterInitializer'],
  }));

  const plan = await service.analyzeInitialization('project-1', false);
  assert.deepEqual(analyzedPaths, ['/canonical/project']);
  assert.equal('projectPath' in plan, false);
  assert.equal(plan.attemptId, 'attempt-1');
});

test('every advertised PRD template is applied by the same canonical service path', async () => {
  const projectPath = await fsPromises.mkdtemp(path.join(tmpdir(), 'taskmaster-api-template-'));
  const service = createTaskmasterApiService(createDependencies(projectPath));

  try {
    const { templates } = service.listPrdTemplates();
    assert.deepEqual(templates.map((template) => template.id), [
      'web-app',
      'api',
      'mobile-app',
      'data-analysis',
    ]);
    for (const template of templates) {
      const fileName = `${template.id}.md`;
      await service.applyPrdTemplate('project-1', template.id, fileName, {});
      const content = await fsPromises.readFile(
        path.join(projectPath, '.taskmaster', 'docs', fileName),
        'utf8',
      );
      assert.match(content, /Product Requirements Document/);
    }

    await assert.rejects(
      service.applyPrdTemplate('project-1', 'web-app', '../escape.md', {}),
      (error: unknown) => error instanceof TaskmasterApiError && error.statusCode === 400,
    );
  } finally {
    await fsPromises.rm(projectPath, { recursive: true, force: true });
  }
});
