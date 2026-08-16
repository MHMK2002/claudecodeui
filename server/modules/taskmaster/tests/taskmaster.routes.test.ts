import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type Request } from 'express';

import { TaskmasterApiError } from '../taskmaster-api.service.js';
import { createTaskmasterRouter } from '../taskmaster.routes.js';

type RouterService = Parameters<typeof createTaskmasterRouter>[0]['taskmasterService'];

function serviceStub(overrides: Partial<RouterService>): RouterService {
  return overrides as RouterService;
}

async function listen(router: ReturnType<typeof createTaskmasterRouter>, authenticated = false) {
  const app = express();
  app.use(express.json());
  if (authenticated) {
    app.use((req, _res, next) => {
      (req as Request & { user: { id: number; username: string } }).user = {
        id: 1,
        username: 'taskmaster-test',
      };
      next();
    });
  }
  app.use('/api/taskmaster', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/taskmaster`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

test('tasks route delegates the project id to the TaskMaster application service', async () => {
  const projectIds: string[] = [];
  const router = createTaskmasterRouter({
    taskmasterService: serviceStub({
      loadTasks: async (projectId) => {
        projectIds.push(projectId);
        throw new TaskmasterApiError(404, {
          error: 'Project not found',
          message: `Project "${projectId}" does not exist`,
        });
      },
    }),
  });
  const server = await listen(router);
  try {
    const response = await fetch(`${server.baseUrl}/tasks/project-1`);
    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
  assert.deepEqual(projectIds, ['project-1']);
});

test('MCP status route delegates detection to the TaskMaster application service', async () => {
  let detectionCount = 0;
  const expected = {
    hasMCPServer: true,
    isConfigured: true,
    hasApiKeys: false,
    scope: 'user',
    config: {
      command: 'npx',
      args: ['-y', 'task-master-ai'],
      url: null,
      envVars: [],
      type: 'stdio',
    },
  };
  const router = createTaskmasterRouter({
    taskmasterService: serviceStub({
      detectMcpServer: async () => {
        detectionCount += 1;
        return expected;
      },
    }),
  });
  const server = await listen(router);
  try {
    const response = await fetch(`${server.baseUrl}/mcp-status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  } finally {
    await server.close();
  }
  assert.equal(detectionCount, 1);
});

test('workflow routes reject a missing authenticated caller before service orchestration', async () => {
  let serviceCalled = false;
  const router = createTaskmasterRouter({
    taskmasterService: serviceStub({
      createIntake: async () => {
        serviceCalled = true;
        return {};
      },
    }),
  });
  const server = await listen(router);
  try {
    const response = await fetch(`${server.baseUrl}/workflow/project-1/intakes`, { method: 'POST' });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      error: 'AUTHENTICATED_USER_REQUIRED',
      message: 'Authenticated user is required.',
    });
  } finally {
    await server.close();
  }
  assert.equal(serviceCalled, false);
});

test('workflow routes hide unexpected application-service errors behind a generic 500', async (t) => {
  const loggedErrors: unknown[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { loggedErrors.push(args); });
  const router = createTaskmasterRouter({
    taskmasterService: serviceStub({
      createIntake: async () => { throw new Error('project index is corrupt'); },
    }),
  });
  const server = await listen(router, true);
  try {
    const response = await fetch(`${server.baseUrl}/workflow/project-1/intakes`, { method: 'POST' });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  } finally {
    await server.close();
  }
  assert.equal(loggedErrors.length, 1);
});

test('Task setup analyze route preserves typed recovery from the application service', async () => {
  let analyzeCalls = 0;
  const router = createTaskmasterRouter({
    taskmasterService: serviceStub({
      analyzeInitialization: async () => {
        analyzeCalls += 1;
        throw Object.assign(new Error('Generated TaskMaster config is malformed.'), {
          code: 'TASKMASTER_CONFIG_CONFLICT',
          statusCode: 409,
          recovery: 'REPAIR',
        });
      },
    }),
  });
  const server = await listen(router);
  try {
    const response = await fetch(`${server.baseUrl}/init/project-1/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repair: false }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      success: false,
      error: 'TASKMASTER_CONFIG_CONFLICT',
      message: 'Generated TaskMaster config is malformed.',
      recovery: 'REPAIR',
    });
  } finally {
    await server.close();
  }
  assert.equal(analyzeCalls, 1);
});

test('Task setup apply route streams application-service progress and a terminal result', async () => {
  const router = createTaskmasterRouter({
    taskmasterService: serviceStub({
      applyInitialization: async (_projectId, _attemptId, onProgress) => {
        onProgress({ stage: 'backup', message: 'Backing up', completed: 0, total: 6 });
        onProgress({ stage: 'success', message: 'Complete', completed: 6, total: 6 });
        return {
          plan: {
            attemptId: 'attempt-1',
            projectPath: '/workspace/project',
            before: { status: 'missing', missing: [], invalid: [] },
            operations: [],
            modelDefaults: null,
            changesExistingModelDefaults: false,
            repair: false,
          },
          after: { status: 'valid', missing: [], invalid: [] },
          added: ['.taskmaster/config.json'],
          replaced: [],
          merged: ['CLAUDE.md'],
          rollbackPerformed: false,
        };
      },
    }),
  });
  const server = await listen(router);
  try {
    const response = await fetch(`${server.baseUrl}/init/project-1/attempts/attempt-1/apply`, {
      method: 'POST',
    });
    assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/);
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line)) as Array<{
      type: string;
      success?: boolean;
      progress?: { stage?: string };
    }>;
    assert.deepEqual(events.filter((event) => event.type === 'progress').map((event) => event.progress?.stage), [
      'backup',
      'success',
    ]);
    assert.equal(events.at(-1)?.success, true);
  } finally {
    await server.close();
  }
});

test('PRD route rejects traversal-like filenames before calling the service', async () => {
  let serviceCalled = false;
  const router = createTaskmasterRouter({
    taskmasterService: serviceStub({
      readPrd: async () => {
        serviceCalled = true;
        throw new Error('service should not run');
      },
    }),
  });
  const server = await listen(router);
  try {
    const response = await fetch(`${server.baseUrl}/prd/project-1/${encodeURIComponent('../secret.md')}`);
    assert.equal(response.status, 400);
  } finally {
    await server.close();
  }
  assert.equal(serviceCalled, false);
});
