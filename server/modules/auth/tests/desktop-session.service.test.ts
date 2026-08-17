import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopSessionService } from '../desktop-session.service.js';

const SECRET = 'desktop-owner-secret';
const NONCE = 'a'.repeat(64);

type TestUser = { id: number; username: string };

function createHarness(options: {
  runtimeMode?: 'desktop-local' | 'desktop-lan';
  existingUser?: TestUser;
  now?: () => number;
} = {}) {
  let firstUser = options.existingUser;
  const calls = {
    begin: 0,
    commit: 0,
    rollback: 0,
    create: 0,
    completeOnboarding: [] as number[],
    updateLastLogin: [] as number[],
    updateCredentials: [] as Array<{ userId: number; username: string; passwordHash: string }>,
  };
  const service = createDesktopSessionService({
    runtimeMode: options.runtimeMode ?? 'desktop-local',
    bootstrapSecret: SECRET,
    users: {
      getFirstUser: () => firstUser,
      createUser: (username) => {
        calls.create += 1;
        firstUser = { id: 41, username };
        return firstUser;
      },
      updateCredentials: (userId, username, passwordHash) => {
        calls.updateCredentials.push({ userId, username, passwordHash });
        if (firstUser?.id === userId) firstUser = { ...firstUser, username };
      },
      completeOnboarding: (userId) => calls.completeOnboarding.push(userId),
      updateLastLogin: (userId) => calls.updateLastLogin.push(userId),
    },
    transaction: {
      begin: () => { calls.begin += 1; },
      commit: () => { calls.commit += 1; },
      rollback: () => { calls.rollback += 1; },
    },
    hashPassword: async () => 'unusable-random-password-hash',
    generateToken: (user) => `session-for-${user.id}`,
    randomSecret: () => 'random-internal-password',
    now: options.now,
  });

  return { service, calls, getFirstUser: () => firstUser };
}

test('fresh Desktop bootstrap creates one incomplete hidden principal for optional setup', async () => {
  const { service, calls, getFirstUser } = createHarness();

  const result = await service.bootstrap({
    providedSecret: SECRET,
    nonce: NONCE,
    remoteAddress: '127.0.0.1',
  });

  assert.deepEqual(result, {
    token: 'session-for-41',
    user: {
      id: 41,
      username: '__cloudcli_desktop_local__',
      internal: true,
    },
  });
  assert.equal(getFirstUser()?.username, '__cloudcli_desktop_local__');
  assert.deepEqual(calls.completeOnboarding, []);
  assert.deepEqual(calls.updateLastLogin, [41]);
  assert.equal(calls.create, 1);
  assert.equal(calls.begin, 1);
  assert.equal(calls.commit, 1);
  assert.equal(calls.rollback, 0);
});

test('Desktop bootstrap preserves and reuses the existing user', async () => {
  const existingUser = { id: 7, username: 'existing-owner' };
  const { service, calls } = createHarness({ existingUser });

  const result = await service.bootstrap({
    providedSecret: SECRET,
    nonce: NONCE,
    remoteAddress: '::1',
  });

  assert.equal(result.user.id, existingUser.id);
  assert.equal(result.user.username, existingUser.username);
  assert.equal(result.user.internal, false);
  assert.equal(calls.create, 0);
  assert.equal(calls.begin, 0);
  assert.deepEqual(calls.updateLastLogin, [7]);
});

test('Desktop bootstrap rejects a wrong owner secret without consuming the nonce', async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.bootstrap({
      providedSecret: 'wrong-secret',
      nonce: NONCE,
      remoteAddress: '127.0.0.1',
    }),
    (error: unknown) => (error as { code?: string }).code === 'DESKTOP_BOOTSTRAP_INVALID',
  );

  const result = await service.bootstrap({
    providedSecret: SECRET,
    nonce: NONCE,
    remoteAddress: '127.0.0.1',
  });
  assert.equal(result.token, 'session-for-41');
});

test('Desktop bootstrap rejects non-loopback requests and non-local runtime modes', async () => {
  const { service } = createHarness();
  await assert.rejects(
    service.bootstrap({
      providedSecret: SECRET,
      nonce: NONCE,
      remoteAddress: '192.168.1.44',
    }),
    (error: unknown) => (error as { code?: string }).code === 'DESKTOP_SESSION_LOOPBACK_REQUIRED',
  );

  const lanHarness = createHarness({ runtimeMode: 'desktop-lan' });
  await assert.rejects(
    lanHarness.service.bootstrap({
      providedSecret: SECRET,
      nonce: NONCE,
      remoteAddress: '127.0.0.1',
    }),
    (error: unknown) => (error as { code?: string }).code === 'DESKTOP_SESSION_UNAVAILABLE',
  );
});

test('Desktop bootstrap nonce is accepted exactly once', async () => {
  const { service } = createHarness({ existingUser: { id: 2, username: 'owner' } });
  const request = {
    providedSecret: SECRET,
    nonce: NONCE,
    remoteAddress: '::ffff:127.0.0.1',
  };

  await service.bootstrap(request);
  await assert.rejects(
    service.bootstrap(request),
    (error: unknown) => (error as { code?: string }).code === 'DESKTOP_BOOTSTRAP_REPLAYED',
  );
});

test('used bootstrap nonces remain rejected after the browser-handoff TTL', async () => {
  let clock = 1_000;
  const { service } = createHarness({
    existingUser: { id: 2, username: 'owner' },
    now: () => clock,
  });
  const request = {
    providedSecret: SECRET,
    nonce: NONCE,
    remoteAddress: '127.0.0.1',
  };

  await service.bootstrap(request);
  clock += 60_001;
  await assert.rejects(
    service.bootstrap(request),
    (error: unknown) => (error as { code?: string }).code === 'DESKTOP_BOOTSTRAP_REPLAYED',
  );
});

test('browser handoff is one-time and expires after one minute', async () => {
  let clock = 1_000;
  const { service } = createHarness({
    existingUser: { id: 3, username: 'owner' },
    now: () => clock,
  });

  const registered = service.registerBrowserHandoff({
    providedSecret: SECRET,
    nonce: NONCE,
    remoteAddress: '127.0.0.1',
  });
  assert.equal(registered.path, `/api/auth/desktop-handoff/${NONCE}`);

  const consumed = await service.consumeBrowserHandoff(NONCE, '::1');
  assert.equal(consumed.token, 'session-for-3');
  await assert.rejects(
    service.consumeBrowserHandoff(NONCE, '::1'),
    (error: unknown) => (error as { code?: string }).code === 'DESKTOP_HANDOFF_INVALID',
  );

  const nextNonce = 'b'.repeat(64);
  service.registerBrowserHandoff({
    providedSecret: SECRET,
    nonce: nextNonce,
    remoteAddress: '127.0.0.1',
  });
  clock += 60_001;
  await assert.rejects(
    service.consumeBrowserHandoff(nextNonce, '127.0.0.1'),
    (error: unknown) => (error as { code?: string }).code === 'DESKTOP_HANDOFF_INVALID',
  );
});

test('explicit LAN setup replaces credentials in place without replacing the user', async () => {
  const { service, calls, getFirstUser } = createHarness({
    existingUser: { id: 12, username: '__cloudcli_desktop_local__' },
  });

  const result = await service.configureLanCredentials({
    providedSecret: SECRET,
    nonce: NONCE,
    remoteAddress: '127.0.0.1',
    username: 'lan-owner',
    password: 'secure-password',
  });

  assert.deepEqual(result, { success: true, username: 'lan-owner' });
  assert.equal(getFirstUser()?.id, 12);
  assert.equal(getFirstUser()?.username, 'lan-owner');
  assert.deepEqual(calls.updateCredentials, [{
    userId: 12,
    username: 'lan-owner',
    passwordHash: 'unusable-random-password-hash',
  }]);
  assert.deepEqual(calls.completeOnboarding, [12]);
});
