import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import taskmasterRouter from './taskmaster.js';

test('legacy task-producing routes cannot bypass explicit intake approval', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/taskmaster', taskmasterRouter);
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
