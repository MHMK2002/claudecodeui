import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

test('authenticated routes parse canonical project/profile schedule input', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'scheduled-runs-route-'));
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');

  const database = await import('@/modules/database/index.js');
  database.closeConnection();
  await database.initializeDatabase();
  const user = database.userDb.createUser('schedule-ui', 'unused-password-hash');
  const { authenticateToken, generateToken } = await import('@/modules/auth/index.js');
  const { createScheduledRunsRouter } = await import('../scheduled-runs.routes.js');
  const capturedCreates: Record<string, unknown>[] = [];
  const routeService = {
    list: () => [],
    get: () => { throw new Error('not used'); },
    create: async (_userId: number, input: Record<string, unknown>) => {
      capturedCreates.push(input);
      return {
        id: 1,
        userId: user.id,
        projectPath: '/canonical/project',
        lastRunAt: null,
        nextRunAt: '2026-08-17T08:00:00.000Z',
        inFlightRunId: null,
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
        notifyChannels: null,
        ...input,
      };
    },
    update: async () => { throw new Error('not used'); },
    remove: () => undefined,
    setEnabled: async () => { throw new Error('not used'); },
    history: () => [],
    runNow: async () => ({ runId: 1 }),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/scheduled-runs', authenticateToken, createScheduledRunsRouter(
    routeService as unknown as Parameters<typeof createScheduledRunsRouter>[0],
  ));
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

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/api/scheduled-runs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${generateToken(user)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Daily review',
        projectId: 'project-1',
        provider: 'codex',
        providerProfileId: 4,
        model: 'gpt-test',
        prompt: 'Review the project',
        cronExpression: '0 8 * * *',
        timezone: 'UTC',
      }),
    });
    assert.equal(createResponse.status, 201, await createResponse.text());
    const capturedCreate = capturedCreates[0];
    assert.ok(capturedCreate);
    assert.equal(capturedCreate.projectId, 'project-1');
    assert.equal(capturedCreate.providerProfileId, 4);
    assert.equal('projectPath' in capturedCreate, false);

    const invalidResponse = await fetch(`http://127.0.0.1:${address.port}/api/scheduled-runs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${generateToken(user)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ projectPath: '/client/supplied/path' }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal((await invalidResponse.json() as { code?: string }).code, 'INVALID_SCHEDULE');
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

test('desktop-local schedules require the cookie session boundary and enforce mutation origin', async () => {
  const { createAuthBoundary } = await import('@/modules/auth/index.js');
  const { SESSION_COOKIE_NAME } = await import('@/shared/utils.js');
  const { createScheduledRunsRouter } = await import('../scheduled-runs.routes.js');
  const user = { id: 7, username: 'desktop-owner' };
  const boundary = createAuthBoundary({
    runtimeMode: 'desktop-local',
    jwtSecret: 'scheduled-runs-desktop-local-test-secret',
    users: {
      getFirstUser: () => user,
      getUserById: (userId) => userId === user.id ? user : undefined,
    },
  });
  const routeService = {
    list: () => [],
    get: () => { throw new Error('not used'); },
    create: async (_userId: number, input: Record<string, unknown>) => ({ id: 1, ...input }),
    update: async () => { throw new Error('not used'); },
    remove: () => undefined,
    setEnabled: async () => { throw new Error('not used'); },
    history: () => [],
    runNow: async () => ({ runId: 1 }),
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/api/scheduled-runs',
    boundary.authenticateToken,
    createScheduledRunsRouter(
      routeService as unknown as Parameters<typeof createScheduledRunsRouter>[0],
    ),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api/scheduled-runs`;
    const token = boundary.generateToken(user);
    const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;

    const cookieResponse = await fetch(baseUrl, { headers: { cookie } });
    assert.equal(cookieResponse.status, 200, await cookieResponse.text());

    const bearerResponse = await fetch(baseUrl, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(bearerResponse.status, 401);
    assert.equal((await bearerResponse.json() as { code?: string }).code, 'AUTH_TOKEN_INVALID');

    const apiKeyResponse = await fetch(baseUrl, {
      headers: { 'x-api-key': 'valid-external-key' },
    });
    assert.equal(apiKeyResponse.status, 401);
    assert.equal((await apiKeyResponse.json() as { code?: string }).code, 'AUTH_TOKEN_INVALID');

    const invalidOriginResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        origin: 'https://attacker.example',
      },
      body: JSON.stringify({}),
    });
    assert.equal(invalidOriginResponse.status, 403);
    assert.equal(
      (await invalidOriginResponse.json() as { code?: string }).code,
      'AUTH_ORIGIN_INVALID',
    );
  } finally {
    server.close();
    await once(server, 'close');
  }
});
