import assert from 'node:assert/strict';
import test from 'node:test';

import type { LLMProvider } from '../src/types/app';
import type { ProviderAuthStatus } from '../src/components/provider-auth/types';
import { createProviderAuthStatusCache } from '../src/components/provider-auth/providerAuthStatusCache';

const authenticatedStatus: ProviderAuthStatus = {
  authenticated: true,
  email: 'user@example.com',
  method: 'oauth',
  loading: false,
  error: null,
};

test('shares an in-flight request and reuses it only for the finite TTL', async () => {
  let now = 100;
  let loadCount = 0;
  let resolveRequest: ((status: ProviderAuthStatus) => void) | undefined;
  const cache = createProviderAuthStatusCache({
    getScope: () => 'user:1',
    now: () => now,
    ttlMs: 50,
    loadStatus: async (_provider: LLMProvider) => {
      loadCount += 1;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
  });

  const first = cache.load('claude');
  const second = cache.load('claude');
  assert.equal(loadCount, 1);
  resolveRequest?.(authenticatedStatus);
  assert.deepEqual(await Promise.all([first, second]), [authenticatedStatus, authenticatedStatus]);

  assert.equal(await cache.load('claude'), authenticatedStatus);
  assert.equal(loadCount, 1);

  now += 51;
  const expired = cache.load('claude');
  assert.equal(loadCount, 2);
  resolveRequest?.(authenticatedStatus);
  await expired;
});

test('isolates cached and in-flight values by authenticated user scope', async () => {
  let scope = 'user:1';
  let loadCount = 0;
  const resolvers: Array<(status: ProviderAuthStatus) => void> = [];
  const cache = createProviderAuthStatusCache({
    getScope: () => scope,
    loadStatus: async () => {
      loadCount += 1;
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });

  const firstUserRequest = cache.load('cursor');
  scope = 'user:2';
  const secondUserRequest = cache.load('cursor');
  assert.equal(loadCount, 2);

  resolvers[0]?.({ ...authenticatedStatus, email: 'first@example.com' });
  resolvers[1]?.({ ...authenticatedStatus, email: 'second@example.com' });
  assert.equal((await firstUserRequest).email, 'first@example.com');
  assert.equal((await secondUserRequest).email, 'second@example.com');
  assert.equal((await cache.load('cursor')).email, 'second@example.com');
  assert.equal(loadCount, 2);
});

test('invalidation and force refresh bypass stale values while forced callers deduplicate', async () => {
  let loadCount = 0;
  const resolvers: Array<(status: ProviderAuthStatus) => void> = [];
  const cache = createProviderAuthStatusCache({
    getScope: () => 'user:1',
    loadStatus: async () => {
      loadCount += 1;
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });

  const initial = cache.load('codex');
  resolvers[0]?.(authenticatedStatus);
  await initial;

  const forced = cache.load('codex', { force: true });
  const duplicateForced = cache.load('codex', { force: true });
  assert.equal(loadCount, 2);
  resolvers[1]?.({ ...authenticatedStatus, method: 'api_key' });
  assert.equal((await forced).method, 'api_key');
  assert.equal((await duplicateForced).method, 'api_key');

  cache.invalidate('codex');
  const invalidated = cache.load('codex');
  assert.equal(loadCount, 3);
  resolvers[2]?.({ ...authenticatedStatus, method: 'custom_provider' });
  assert.equal((await invalidated).method, 'custom_provider');
});
