import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProject,
  resolveActiveProjectDirectory,
} from '@/modules/projects/services/project-management.service.js';
import { AppError } from '@/shared/utils.js';

const projectRow = {
  project_id: 'project-1',
  project_path: '/workspace/my-project',
  custom_project_name: 'my-project',
  isStarred: 0,
  isArchived: 0,
};

type TestDependencies = NonNullable<Parameters<typeof createProject>[1]>;

function buildDependencies(overrides: Partial<TestDependencies> = {}): TestDependencies {
  return {
    validatePath: async (projectPath) => ({ valid: true, resolvedPath: projectPath }),
    inspectWorkspaceDirectory: async () => 'ready',
    persistProjectPath: () => ({ outcome: 'created', project: projectRow }),
    getProjectByPath: () => projectRow,
    ...overrides,
  };
}

test('createProject throws when project path is missing', async () => {
  await assert.rejects(
    async () => createProject({ projectPath: '' }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'PROJECT_PATH_REQUIRED');
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
});

test('createProject throws when path validation fails', async () => {
  await assert.rejects(
    async () =>
      createProject(
        { projectPath: '/invalid/path' },
        buildDependencies({
          validatePath: async () => ({ valid: false, error: 'blocked path' }),
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'INVALID_PROJECT_PATH');
      assert.equal(error.statusCode, 400);
      assert.deepEqual(error.details, {
        action: 'BROWSE',
        field: 'folder',
        reason: 'blocked path',
      });
      return true;
    },
  );
});

test('createProject throws conflict when active project path already exists', async () => {
  await assert.rejects(
    async () =>
      createProject(
        { projectPath: '/workspace/my-project' },
        buildDependencies({
          validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
          persistProjectPath: () => ({ outcome: 'active_conflict', project: projectRow }),
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'PROJECT_ALREADY_EXISTS');
      assert.equal(error.statusCode, 409);
      assert.deepEqual(error.details, {
        action: 'CHOOSE_ANOTHER',
        field: 'folder',
        projectPath: '/workspace/my-project',
      });
      return true;
    },
  );
});

test('createProject falls back to directory name when custom name is not provided', async () => {
  let capturedCustomName: string | null = null;

  const result = await createProject(
    { projectPath: '/workspace/my-project', customName: '' },
    buildDependencies({
      validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
      persistProjectPath: (_projectPath, customName) => {
        capturedCustomName = customName;
        return {
          outcome: 'created',
          project: {
            ...projectRow,
            custom_project_name: customName,
          },
        };
      },
    }),
  );

  assert.equal(capturedCustomName, 'my-project');
  assert.equal(result.outcome, 'created');
  assert.equal(result.project.displayName, 'my-project');
});

test('createProject returns archived reuse outcome when archived row is reused', async () => {
  const result = await createProject(
    { projectPath: '/workspace/my-project' },
    buildDependencies({
      validatePath: async () => ({ valid: true, resolvedPath: '/workspace/my-project' }),
      persistProjectPath: () => ({
        outcome: 'reactivated_archived',
        project: {
          ...projectRow,
          isArchived: 1,
        },
      }),
    }),
  );

  assert.equal(result.outcome, 'reactivated_archived');
  assert.equal(result.project.isArchived, true);
});

test('createProject never creates a missing local folder', async () => {
  let persisted = false;
  await assert.rejects(
    () => createProject({ projectPath: '/workspace/missing' }, buildDependencies({
      inspectWorkspaceDirectory: async () => 'missing',
      persistProjectPath: () => {
        persisted = true;
        return { outcome: 'created', project: projectRow };
      },
    })),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'INVALID_PROJECT_PATH');
      assert.deepEqual(error.details, { action: 'BROWSE', field: 'folder' });
      return true;
    },
  );
  assert.equal(persisted, false);
});

test('createProject rejects an existing but unwritable local folder', async () => {
  await assert.rejects(
    () => createProject({ projectPath: '/workspace/read-only' }, buildDependencies({
      inspectWorkspaceDirectory: async () => 'unwritable',
    })),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'PROJECT_PATH_NOT_WRITABLE');
      assert.equal(error.statusCode, 403);
      assert.deepEqual(error.details, { action: 'CHOOSE_ANOTHER', field: 'folder' });
      return true;
    },
  );
});

test('Shell project resolution returns only the stored path of an active project id', () => {
  assert.equal(
    resolveActiveProjectDirectory('project-1', (projectId) => (
      projectId === 'project-1' ? projectRow : null
    )),
    '/workspace/my-project',
  );
  assert.equal(resolveActiveProjectDirectory('missing', () => null), null);
  assert.equal(
    resolveActiveProjectDirectory('archived', () => ({ ...projectRow, isArchived: 1 })),
    null,
  );
});
