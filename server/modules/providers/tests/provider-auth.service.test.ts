import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderAuthService } from '@/modules/providers/services/provider-auth.service.js';

test('provider auth status shares in-flight work and honors its TTL', async () => {
  let clock = 100;
  let calls = 0;
  const service = createProviderAuthService({
    now: () => clock,
    ttlMs: 10,
    resolveProvider: (() => ({
      auth: {
        getStatus: async () => {
          calls += 1;
          await Promise.resolve();
          return { installed: true, authenticated: true };
        },
      },
    })) as never,
  });

  const [first, second] = await Promise.all([
    service.getProviderAuthStatus('cursor'),
    service.getProviderAuthStatus('cursor'),
  ]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);

  await service.getProviderAuthStatus('cursor');
  assert.equal(calls, 1);

  clock = 111;
  await service.getProviderAuthStatus('cursor');
  assert.equal(calls, 2);
});

test('provider auth invalidation forces one fresh status lookup', async () => {
  let calls = 0;
  const service = createProviderAuthService({
    ttlMs: 60_000,
    resolveProvider: (() => ({
      auth: {
        getStatus: async () => ({ installed: true, authenticated: ++calls > 1 }),
      },
    })) as never,
  });

  assert.equal((await service.getProviderAuthStatus('opencode')).authenticated, false);
  service.invalidateProviderAuthStatus('opencode');
  const [fresh, shared] = await Promise.all([
    service.getProviderAuthStatus('opencode'),
    service.getProviderAuthStatus('opencode'),
  ]);
  assert.equal(fresh.authenticated, true);
  assert.deepEqual(fresh, shared);
  assert.equal(calls, 2);
});

test('concurrent forced refreshes still share one CLI status operation', async () => {
  let calls = 0;
  const service = createProviderAuthService({
    resolveProvider: (() => ({
      auth: {
        getStatus: async () => {
          calls += 1;
          await Promise.resolve();
          return { installed: true, authenticated: true };
        },
      },
    })) as never,
  });

  await Promise.all([
    service.getProviderAuthStatus('cursor', { forceRefresh: true }),
    service.getProviderAuthStatus('cursor', { forceRefresh: true }),
  ]);
  assert.equal(calls, 1);
});
