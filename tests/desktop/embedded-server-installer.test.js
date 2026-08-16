import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import test from 'node:test';

import { ServerInstaller } from '../../electron/serverInstaller.js';

const execFileAsync = promisify(execFile);
const TEST_VERSION = '1.37.0';
const TEST_BUILD_ID = 'desktop-installer-test-build';
const TEST_PLATFORM = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
const TEST_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';

async function createBundle(root, content, overrides = {}) {
  const source = path.join(root, 'source');
  const entry = path.join(source, 'dist-server', 'server', 'index.js');
  const identityPath = path.join(source, 'dist', 'build-identity.json');
  const compiledIdentityPath = path.join(source, 'dist-server', 'build-identity.json');
  const archive = path.join(root, 'custom-server.tar.gz');
  const identity = {
    version: overrides.version || TEST_VERSION,
    buildId: overrides.buildId || TEST_BUILD_ID,
  };
  await fs.rm(source, { recursive: true, force: true });
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.mkdir(path.dirname(identityPath), { recursive: true });
  await fs.mkdir(path.dirname(compiledIdentityPath), { recursive: true });
  await fs.writeFile(entry, content);
  await fs.writeFile(identityPath, JSON.stringify(identity));
  await fs.writeFile(compiledIdentityPath, JSON.stringify(identity));
  await fs.writeFile(path.join(source, '.installed.json'), JSON.stringify({
    productName: 'CloudCLI',
    features: { cloud: false, hosted: false, pro: false },
    ...identity,
    platform: overrides.platform || TEST_PLATFORM,
    arch: overrides.arch || TEST_ARCH,
    builtAt: new Date().toISOString(),
  }));
  await execFileAsync('tar', ['-czf', archive, '-C', source, '.']);
  const checksum = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  await fs.writeFile(`${archive}.sha256`, `${checksum}  ${path.basename(archive)}\n`);
  return { archive, checksum, source };
}

async function repackBundle(bundle) {
  await execFileAsync('tar', ['-czf', bundle.archive, '-C', bundle.source, '.']);
  const checksum = crypto.createHash('sha256').update(await fs.readFile(bundle.archive)).digest('hex');
  await fs.writeFile(`${bundle.archive}.sha256`, `${checksum}  ${path.basename(bundle.archive)}\n`);
}

test('embedded server archive installs without contacting a release URL', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { archive, checksum } = await createBundle(root, '// personalized build');
  const logs = [];
  const installer = new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
    installRoot: path.join(root, 'installed'),
    onLog: (line) => logs.push(line),
  });

  const entry = await installer.ensureInstalledFromArchive(archive);

  assert.equal(await fs.readFile(entry, 'utf8'), '// personalized build');
  const marker = JSON.parse(await fs.readFile(path.join(installer.getVersionDir(), '.installed.json'), 'utf8'));
  assert.equal(marker.source, 'embedded');
  assert.equal(marker.sourceChecksum, checksum);
  assert.equal(marker.buildId, TEST_BUILD_ID);
  assert.match(marker.entrySha256, /^[a-f0-9]{64}$/);
  assert.equal(logs.some((line) => line.includes('github.com')), false);
  await installer.confirmInstalledRuntime();
  await assert.rejects(fs.access(installer.getActivationPath()), { code: 'ENOENT' });
});

test('a changed customized archive replaces an installed runtime with the same version', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installer = new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
    installRoot: path.join(root, 'installed'),
  });
  const first = await createBundle(root, '// first build');
  await installer.ensureInstalledFromArchive(first.archive);
  await installer.confirmInstalledRuntime();
  const second = await createBundle(root, '// second personalized build');

  const entry = await installer.ensureInstalledFromArchive(second.archive);

  assert.equal(await fs.readFile(entry, 'utf8'), '// second personalized build');
});

test('checksum mismatch is rejected before replacing an installed runtime', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installer = new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
    installRoot: path.join(root, 'installed'),
  });
  const first = await createBundle(root, '// retained build');
  const entry = await installer.ensureInstalledFromArchive(first.archive);
  await installer.confirmInstalledRuntime();
  const broken = await createBundle(root, '// rejected build');
  await fs.writeFile(`${broken.archive}.sha256`, `${'0'.repeat(64)}  broken.tar.gz\n`);

  await assert.rejects(
    installer.ensureInstalledFromArchive(broken.archive),
    /checksum mismatch/i,
  );
  assert.equal(await fs.readFile(entry, 'utf8'), '// retained build');
});

test('incompatible archive identity is rejected before replacing an installed runtime', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installer = new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
    installRoot: path.join(root, 'installed'),
  });
  const first = await createBundle(root, '// retained build');
  const entry = await installer.ensureInstalledFromArchive(first.archive);
  await installer.confirmInstalledRuntime();
  const incompatible = await createBundle(root, '// wrong build', { buildId: 'different-build' });

  await assert.rejects(
    installer.ensureInstalledFromArchive(incompatible.archive),
    /does not match desktop buildId/i,
  );
  assert.equal(await fs.readFile(entry, 'utf8'), '// retained build');
});

test('archive metadata and target incompatibilities fail before installation', async (t) => {
  const cases = [
    {
      name: 'version mismatch',
      overrides: { version: '9.9.9' },
      expected: /does not match package version/i,
    },
    {
      name: 'platform mismatch',
      overrides: { platform: TEST_PLATFORM === 'linux' ? 'mac' : 'linux' },
      expected: /target .* does not match desktop target/i,
    },
    {
      name: 'architecture mismatch',
      overrides: { arch: TEST_ARCH === 'arm64' ? 'x64' : 'arm64' },
      expected: /target .* does not match desktop target/i,
    },
    {
      name: 'malformed metadata',
      mutate: async (bundle) => fs.writeFile(path.join(bundle.source, '.installed.json'), '{bad'),
      expected: /metadata is missing or invalid/i,
    },
    {
      name: 'missing client identity',
      mutate: async (bundle) => fs.rm(path.join(bundle.source, 'dist', 'build-identity.json')),
      expected: /distribution identity could not be read/i,
    },
    {
      name: 'missing compiled server identity',
      mutate: async (bundle) => fs.rm(path.join(bundle.source, 'dist-server', 'build-identity.json')),
      expected: /compiled server identity could not be read/i,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async (caseContext) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-negative-'));
      caseContext.after(() => fs.rm(root, { recursive: true, force: true }));
      const bundle = await createBundle(root, '// incompatible bundle', testCase.overrides);
      if (testCase.mutate) {
        await testCase.mutate(bundle);
        await repackBundle(bundle);
      }
      const installer = new ServerInstaller({
        buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
        installRoot: path.join(root, 'installed'),
      });

      await assert.rejects(
        installer.ensureInstalledFromArchive(bundle.archive),
        testCase.expected,
      );
      await assert.rejects(fs.access(installer.getVersionDir()), { code: 'ENOENT' });
    });
  }
});

test('archive links are rejected before extraction', { skip: process.platform === 'win32' }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installer = new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
    installRoot: path.join(root, 'installed'),
  });
  const bundle = await createBundle(root, '// link test');
  await fs.symlink('dist/build-identity.json', path.join(bundle.source, 'identity-link'));
  await execFileAsync('tar', ['-czf', bundle.archive, '-C', bundle.source, '.']);
  const checksum = crypto.createHash('sha256').update(await fs.readFile(bundle.archive)).digest('hex');
  await fs.writeFile(`${bundle.archive}.sha256`, `${checksum}  ${path.basename(bundle.archive)}\n`);

  await assert.rejects(
    installer.ensureInstalledFromArchive(bundle.archive),
    /link or special entry/i,
  );
});

test('failed post-launch validation restores the previous runtime', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installer = new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
    installRoot: path.join(root, 'installed'),
  });
  const first = await createBundle(root, '// previous healthy build');
  const entry = await installer.ensureInstalledFromArchive(first.archive);
  await installer.confirmInstalledRuntime();
  const replacement = await createBundle(root, '// replacement that fails health');
  await installer.ensureInstalledFromArchive(replacement.archive);

  await installer.rollbackInstalledRuntime();

  assert.equal(await fs.readFile(entry, 'utf8'), '// previous healthy build');
});

test('a new installer instance recovers a pending activation after a crash', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'installed');
  const createInstaller = () => new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
    installRoot,
  });
  const originalInstaller = createInstaller();
  const first = await createBundle(root, '// confirmed runtime');
  const entry = await originalInstaller.ensureInstalledFromArchive(first.archive);
  await originalInstaller.confirmInstalledRuntime();
  const replacement = await createBundle(root, '// pending runtime before crash');
  await originalInstaller.ensureInstalledFromArchive(replacement.archive);
  assert.equal(await fs.readFile(entry, 'utf8'), '// pending runtime before crash');

  const recoveredInstaller = createInstaller();
  assert.equal(await recoveredInstaller.recoverInterruptedActivation(), true);

  assert.equal(await fs.readFile(entry, 'utf8'), '// confirmed runtime');
  await assert.rejects(fs.access(recoveredInstaller.getActivationPath()), { code: 'ENOENT' });
});

test('a same-version newer Desktop build recovers the previous build activation journal', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'installed');
  const oldInstaller = new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
    installRoot,
  });
  const first = await createBundle(root, '// prior confirmed build');
  const entry = await oldInstaller.ensureInstalledFromArchive(first.archive);
  await oldInstaller.confirmInstalledRuntime();
  const pending = await createBundle(root, '// old build pending at crash');
  await oldInstaller.ensureInstalledFromArchive(pending.archive);

  const newerInstaller = new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: 'newer-same-version-build' },
    installRoot,
  });
  assert.equal(await newerInstaller.recoverInterruptedActivation(), true);

  assert.equal(await fs.readFile(entry, 'utf8'), '// prior confirmed build');
  await assert.rejects(fs.access(newerInstaller.getActivationPath()), { code: 'ENOENT' });
});

test('installation consumes the immutable validated archive copy', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundle = await createBundle(root, '// validated bytes');
  let replacedSource = false;
  const installer = new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
    installRoot: path.join(root, 'installed'),
    onLog: (line) => {
      if (!replacedSource && line.includes('Installing customized')) {
        replacedSource = true;
        writeFileSync(bundle.archive, 'not the validated archive');
      }
    },
  });

  const entry = await installer.ensureInstalledFromArchive(bundle.archive);

  assert.equal(replacedSource, true);
  assert.equal(await fs.readFile(entry, 'utf8'), '// validated bytes');
});

test('a corrupted cached server entry is reinstalled from the verified archive', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installer = new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
    installRoot: path.join(root, 'installed'),
  });
  const bundle = await createBundle(root, '// healthy cached entry');
  const entry = await installer.ensureInstalledFromArchive(bundle.archive);
  await installer.confirmInstalledRuntime();
  await fs.writeFile(entry, '// corrupt cached entry');

  await installer.ensureInstalledFromArchive(bundle.archive);

  assert.equal(await fs.readFile(entry, 'utf8'), '// healthy cached entry');
});

test('activation recovery rejects paths outside the installer root', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-embedded-server-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'installed');
  const outside = path.join(root, 'must-not-delete');
  await fs.mkdir(installRoot, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, 'sentinel'), 'preserved');
  const installer = new ServerInstaller({
    buildIdentity: { version: TEST_VERSION, buildId: TEST_BUILD_ID },
    installRoot,
  });
  const activationId = `999-${'a'.repeat(16)}`;
  await fs.writeFile(installer.getActivationPath(), JSON.stringify({
    schemaVersion: 1,
    version: TEST_VERSION,
    buildId: TEST_BUILD_ID,
    state: 'pending',
    activationId,
    versionDir: installer.getVersionDir(),
    stageDir: outside,
    backupDir: path.join(installRoot, `.backup-${TEST_VERSION}-${activationId}`),
    movedExisting: false,
  }));

  await assert.rejects(installer.recoverInterruptedActivation(), /stage directory is invalid/i);
  assert.equal(await fs.readFile(path.join(outside, 'sentinel'), 'utf8'), 'preserved');
});
