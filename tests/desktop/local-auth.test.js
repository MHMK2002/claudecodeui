import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isUsableLocalAuthToken, LocalAuthStore } from '../../electron/localAuth.js';

function makeToken(expiresAtMs) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp: Math.floor(expiresAtMs / 1000) })}.signature`;
}

test('local auth token validity requires a future JWT expiry', () => {
  const now = 1_800_000_000_000;
  assert.equal(isUsableLocalAuthToken(makeToken(now + 60_000), now), true);
  assert.equal(isUsableLocalAuthToken(makeToken(now - 1), now), false);
  assert.equal(isUsableLocalAuthToken('not-a-token', now), false);
});

test('local auth store persists a usable token with owner-only permissions', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-local-auth-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const storePath = path.join(directory, 'local-auth.json');
  const token = makeToken(Date.now() + 60_000);

  const store = new LocalAuthStore(storePath);
  await store.save(token);

  const reloaded = new LocalAuthStore(storePath);
  assert.equal(await reloaded.load(), token);
  assert.equal((await fs.stat(storePath)).mode & 0o777, 0o600);
});

test('local auth store removes expired credentials', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-local-auth-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const storePath = path.join(directory, 'local-auth.json');
  await fs.writeFile(storePath, JSON.stringify({ token: makeToken(Date.now() - 60_000) }));

  const store = new LocalAuthStore(storePath);
  assert.equal(await store.load(), null);
  await assert.rejects(fs.access(storePath));
});
