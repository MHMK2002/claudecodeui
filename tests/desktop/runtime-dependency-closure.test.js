import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { copyRuntimeDependencyClosure } from '../../scripts/release/runtime-dependency-closure.js';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

async function writePackage(directory, manifest) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
  await writeFile(path.join(directory, 'index.js'), `module.exports = ${JSON.stringify(manifest.name)};\n`, 'utf8');
}

test('desktop staging copies the complete resolved runtime dependency closure', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'cloudcli-runtime-root-'));
  const stageDir = await mkdtemp(path.join(tmpdir(), 'cloudcli-runtime-stage-'));
  try {
    await writePackage(path.join(rootDir, 'node_modules', 'alpha'), {
      name: 'alpha',
      version: '1.0.0',
      dependencies: { beta: '2.0.0', gamma: '3.0.0' },
      optionalDependencies: { missing: '1.0.0' },
    });
    await writePackage(path.join(rootDir, 'node_modules', 'alpha', 'node_modules', 'beta'), {
      name: 'beta',
      version: '2.0.0',
      dependencies: { gamma: '3.0.0' },
    });
    await writePackage(path.join(rootDir, 'node_modules', 'gamma'), {
      name: 'gamma',
      version: '3.0.0',
    });

    const copied = await copyRuntimeDependencyClosure({ rootDir, stageDir, packageNames: ['alpha'] });
    assert.deepEqual(copied.map((entry) => `${entry.name}@${entry.version}`), [
      'alpha@1.0.0',
      'beta@2.0.0',
      'gamma@3.0.0',
    ]);
    assert.equal(
      JSON.parse(await readFile(path.join(stageDir, 'node_modules', 'alpha', 'node_modules', 'beta', 'package.json'), 'utf8')).version,
      '2.0.0',
    );
    assert.equal(
      JSON.parse(await readFile(path.join(stageDir, 'node_modules', 'gamma', 'package.json'), 'utf8')).version,
      '3.0.0',
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(stageDir, { recursive: true, force: true });
  }
});

test('desktop staging fails closed when a required runtime dependency is missing', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'cloudcli-runtime-missing-root-'));
  const stageDir = await mkdtemp(path.join(tmpdir(), 'cloudcli-runtime-missing-stage-'));
  try {
    await writePackage(path.join(rootDir, 'node_modules', 'alpha'), {
      name: 'alpha',
      version: '1.0.0',
      dependencies: { missing: '1.0.0' },
    });
    await assert.rejects(
      copyRuntimeDependencyClosure({ rootDir, stageDir, packageNames: ['alpha'] }),
      /required desktop dependency is missing/i,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(stageDir, { recursive: true, force: true });
  }
});

test('installed electron-updater runtime closure is self-contained', async () => {
  const stageDir = await mkdtemp(path.join(tmpdir(), 'cloudcli-real-runtime-stage-'));
  try {
    const copied = await copyRuntimeDependencyClosure({
      rootDir: repositoryRoot,
      stageDir,
      packageNames: ['electron-updater', 'ws', '@nut-tree-fork/nut-js', 'screenshot-desktop'],
    });
    const copiedNames = new Set(copied.map((entry) => entry.name));
    for (const packageName of [
      'electron-updater',
      'builder-util-runtime',
      'clipboardy',
      'fs-extra',
      'jimp',
      'js-yaml',
      'semver',
      'temp',
      'ws',
    ]) {
      assert.equal(copiedNames.has(packageName), true, `${packageName} was not staged`);
    }
    assert.equal(
      JSON.parse(await readFile(path.join(stageDir, 'node_modules', 'electron-updater', 'package.json'), 'utf8')).version,
      '6.8.9',
    );
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
});

test('the separate local-server bundle excludes the Electron-only updater', async () => {
  const source = await readFile(
    new URL('../../scripts/release/build-server-bundle.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /delete stagedPackageJson\.dependencies\['electron-updater'\]/);
});
