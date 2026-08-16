import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadServerBuildIdentity } from '../build-identity.service.js';

async function createAppRoot(t: test.TestContext): Promise<string> {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-build-identity-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(appRoot, 'package.json'),
    JSON.stringify({ version: '1.37.0' }),
    'utf8',
  );
  return appRoot;
}

async function writeIdentity(appRoot: string, relativeDirectory: string, value: unknown): Promise<void> {
  const directory = path.join(appRoot, relativeDirectory);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'build-identity.json'), JSON.stringify(value), 'utf8');
}

test('git runtime prefers the canonical build-start identity', async (t) => {
  const appRoot = await createAppRoot(t);
  await writeIdentity(appRoot, '.build-identity', { version: '1.37.0', buildId: 'canonical-build' });
  await writeIdentity(appRoot, 'dist', { version: '1.37.0', buildId: 'older-dist-build' });

  assert.deepEqual(loadServerBuildIdentity({ appRoot, runtimeLayout: 'source' }), {
    version: '1.37.0',
    buildId: 'canonical-build',
  });
});

test('compiled runtime requires its embedded dist-server identity', async (t) => {
  const appRoot = await createAppRoot(t);
  await writeIdentity(appRoot, 'dist-server', { version: '1.37.0', buildId: 'archive-build' });

  assert.deepEqual(loadServerBuildIdentity({ appRoot, runtimeLayout: 'compiled' }), {
    version: '1.37.0',
    buildId: 'archive-build',
  });
});

test('git runtime fails closed when the canonical identity is missing', async (t) => {
  const appRoot = await createAppRoot(t);
  await writeIdentity(appRoot, 'dist', { version: '1.37.0', buildId: 'stale-dist-build' });

  assert.throws(
    () => loadServerBuildIdentity({ appRoot, runtimeLayout: 'source' }),
    /identity is missing/i,
  );
});

test('compiled runtime identity does not change when the canonical source identity changes', async (t) => {
  const appRoot = await createAppRoot(t);
  await writeIdentity(appRoot, 'dist-server', { version: '1.37.0', buildId: 'compiled-build' });
  await writeIdentity(appRoot, '.build-identity', { version: '1.37.0', buildId: 'new-source-build' });

  assert.deepEqual(loadServerBuildIdentity({ appRoot, runtimeLayout: 'compiled' }), {
    version: '1.37.0',
    buildId: 'compiled-build',
  });
});

test('server startup rejects missing, synthetic, and version-mismatched identity', async (t) => {
  const appRoot = await createAppRoot(t);
  assert.throws(
    () => loadServerBuildIdentity({ appRoot, runtimeLayout: 'compiled' }),
    /identity is missing/i,
  );

  await writeIdentity(appRoot, 'dist-server', { version: '1.37.0', buildId: '1.37.0-unidentified' });
  assert.throws(
    () => loadServerBuildIdentity({ appRoot, runtimeLayout: 'compiled' }),
    /synthetic buildId/i,
  );

  await writeIdentity(appRoot, 'dist-server', { version: '2.0.0', buildId: 'valid-build' });
  assert.throws(
    () => loadServerBuildIdentity({ appRoot, runtimeLayout: 'compiled' }),
    /does not match package version/i,
  );
});
