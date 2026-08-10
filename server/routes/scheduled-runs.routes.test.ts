import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

test('the signed-in UI can list scheduled runs with its JWT', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'scheduled-runs-route-'));
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');

  const database = await import('../modules/database/index.js');
  database.closeConnection();
  await database.initializeDatabase();
  const user = database.userDb.createUser('schedule-ui', 'unused-password-hash');
  const { generateToken } = await import('../middleware/auth.js');
  const { validateExternalApiKeyOrJwt } = await import('../middleware/api-key.js');

  const app = express();
  app.use(express.json());
  app.get('/api/scheduled-runs', validateExternalApiKeyOrJwt, (_req, res) => {
    res.json({ schedules: [] });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/scheduled-runs`, {
      headers: { authorization: `Bearer ${generateToken(user)}` },
    });
    const payload = await response.json() as { schedules?: unknown[]; error?: string };
    assert.equal(response.status, 200, payload.error);
    assert.deepEqual(payload.schedules, []);
  } finally {
    server.close();
    await once(server, 'close');
    database.closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
