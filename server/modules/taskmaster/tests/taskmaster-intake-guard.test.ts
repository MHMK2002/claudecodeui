import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createTaskmasterRouter } from '../taskmaster.routes.js';

// Task creation is only allowed through the intake flow, where a clarified
// proposal is explicitly approved. The legacy direct-create routes must stay
// closed so nothing can persist a task by calling them straight.
test('legacy task-producing routes cannot bypass explicit intake approval', async () => {
  const router = createTaskmasterRouter({
    fileSystem: {} as typeof import('node:fs'),
    fileSystemPromises: {} as typeof import('node:fs/promises'),
    spawnProcess: (() => { throw new Error('spawn should not run'); }) as unknown as
      Parameters<typeof createTaskmasterRouter>[0]['spawnProcess'],
    resolveProjectPathById: () => { throw new Error('project resolution should not run'); },
    taskmasterService: {
      detectMcpServer: async () => ({
        hasMCPServer: false,
        reason: 'Not configured',
        hasConfig: false,
      }),
    },
  } as unknown as Parameters<typeof createTaskmasterRouter>[0]);

  const app = express();
  app.use(express.json());
  app.use('/api/taskmaster', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    for (const endpoint of ['add-task', 'parse-prd']) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/taskmaster/${endpoint}/project-1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Bypass task',
          description: 'This must never be persisted.',
          fileName: 'prd.txt',
        }),
      });
      const body = await response.json() as { error?: string };
      assert.equal(response.status, 409);
      assert.equal(body.error, 'APPROVAL_REQUIRED');
    }
  } finally {
    server.close();
    await once(server, 'close');
  }
});
