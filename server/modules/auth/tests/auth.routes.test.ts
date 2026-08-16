import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { AppError } from '@/shared/utils.js';

import { createAuthRouter } from '../auth.routes.js';
import { createAuthService } from '../auth.service.js';
import { createDesktopSessionService } from '../desktop-session.service.js';

const SECRET = 'desktop-route-secret';

test('Desktop bootstrap and browser handoff set HttpOnly cookies without exposing tokens', async (t) => {
  const user = { id: 5, username: 'existing-owner' };
  const authService = createAuthService({
    runtimeMode: 'desktop-local',
    users: {
      hasUsers: () => true,
      createUser: () => user,
      getUserByUsername: () => undefined,
      updateLastLogin: () => undefined,
    },
    transaction: { begin() {}, commit() {}, rollback() {} },
    hashPassword: async () => 'hash',
    comparePassword: async () => false,
    generateToken: () => 'header.payload.signature',
  });
  const desktopSessions = createDesktopSessionService({
    runtimeMode: 'desktop-local',
    bootstrapSecret: SECRET,
    users: {
      getFirstUser: () => user,
      createUser: () => user,
      updateCredentials() {},
      completeOnboarding() {},
      updateLastLogin() {},
    },
    transaction: { begin() {}, commit() {}, rollback() {} },
    hashPassword: async () => 'hash',
    generateToken: () => 'header.payload.signature',
  });
  const app = express();
  app.use('/api/auth', createAuthRouter({
    service: authService,
    desktopSessions,
    authenticateToken: (_req, _res, next) => next(),
    runtimeMode: 'desktop-local',
  }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const appError = error instanceof AppError ? error : new AppError('Unexpected failure');
    res.status(appError.statusCode).json({ code: appError.code });
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const bootstrapNonce = 'a'.repeat(64);
  const bootstrap = await fetch(`${origin}/api/auth/desktop-bootstrap`, {
    method: 'POST',
    headers: {
      'x-cloudcli-desktop-session-secret': SECRET,
      'x-cloudcli-desktop-session-nonce': bootstrapNonce,
    },
  });
  const bootstrapBody = await bootstrap.json() as Record<string, unknown>;
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrapBody.success, true);
  assert.equal('token' in bootstrapBody, false);
  assert.match(bootstrap.headers.get('set-cookie') ?? '', /HttpOnly.*SameSite=Strict/);

  const logout = await fetch(`${origin}/api/auth/logout`, { method: 'POST' });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie') ?? '', /cloudcli_session=;.*Max-Age=0/);

  const handoffNonce = 'b'.repeat(64);
  const registration = await fetch(`${origin}/api/auth/desktop-handoff`, {
    method: 'POST',
    headers: {
      'x-cloudcli-desktop-session-secret': SECRET,
      'x-cloudcli-desktop-session-nonce': handoffNonce,
    },
  });
  assert.deepEqual(await registration.json(), {
    path: `/api/auth/desktop-handoff/${handoffNonce}`,
  });

  const handoff = await fetch(
    `${origin}/api/auth/desktop-handoff/${handoffNonce}`,
    { redirect: 'manual' },
  );
  assert.equal(handoff.status, 303);
  assert.equal(handoff.headers.get('location'), '/');
  assert.match(handoff.headers.get('set-cookie') ?? '', /cloudcli_session=.*HttpOnly/);
  assert.equal(handoff.headers.get('referrer-policy'), 'no-referrer');

  const replay = await fetch(
    `${origin}/api/auth/desktop-handoff/${handoffNonce}`,
    { redirect: 'manual' },
  );
  assert.equal(replay.status, 410);
});
