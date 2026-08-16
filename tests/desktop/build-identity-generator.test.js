import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function createGeneratorRepo(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-build-generator-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(root, 'shared'), { recursive: true });
  await fs.copyFile(
    new URL('../../scripts/generate-build-identity.mjs', import.meta.url),
    path.join(root, 'scripts', 'generate-build-identity.mjs'),
  );
  await fs.copyFile(
    new URL('../../shared/buildIdentity.js', import.meta.url),
    path.join(root, 'shared', 'buildIdentity.js'),
  );
  await fs.writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({ type: 'module', version: '1.37.0' })}\n`,
  );
  return root;
}

test('non-force generation rejects a malformed canonical identity without replacing it', async (t) => {
  const root = await createGeneratorRepo(t);
  const artifactDir = path.join(root, '.build-identity');
  const artifactPath = path.join(artifactDir, 'build-identity.json');
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(artifactPath, '{malformed');

  await assert.rejects(
    execFileAsync(process.execPath, ['scripts/generate-build-identity.mjs'], { cwd: root }),
    /Canonical build identity could not be read/i,
  );
  assert.equal(await fs.readFile(artifactPath, 'utf8'), '{malformed');
});

test('concurrent generators converge after one atomic stale-lock takeover', async (t) => {
  const root = await createGeneratorRepo(t);
  const artifactDir = path.join(root, '.build-identity');
  const lockPath = path.join(artifactDir, '.generation-lock');
  await fs.mkdir(lockPath, { recursive: true });
  const staleTime = new Date(Date.now() - 20_000);
  await fs.utimes(lockPath, staleTime, staleTime);

  const results = await Promise.all(
    Array.from({ length: 8 }, () => execFileAsync(
      process.execPath,
      ['scripts/generate-build-identity.mjs'],
      { cwd: root },
    )),
  );

  const identity = JSON.parse(
    await fs.readFile(path.join(artifactDir, 'build-identity.json'), 'utf8'),
  );
  assert.equal(identity.version, '1.37.0');
  assert.match(identity.buildId, /^1\.37\.0-/);
  assert.equal(results.length, 8);
  assert.equal(results.every(({ stdout }) => stdout.includes(identity.buildId)), true);
  await assert.rejects(fs.access(lockPath), { code: 'ENOENT' });
});
