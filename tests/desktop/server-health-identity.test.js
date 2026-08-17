import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => resolve(port));
    });
  });
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExit(child, timeoutMs) {
  if (hasExited(child)) return true;

  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    timeout.unref();
    child.once('exit', onExit);
  });
}

async function stopChild(child) {
  if (hasExited(child)) return;

  child.kill('SIGTERM');
  if (await waitForExit(child, 5_000)) return;

  child.kill('SIGKILL');
  assert.equal(await waitForExit(child, 5_000), true, 'health server did not exit');
}

async function readHealthFromServer(t, {
  command,
  args,
  cwd,
  identity,
  runtimeEnv = {},
  expectDirectPid = true,
}) {
  const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-health-home-'));
  const port = await reservePort();
  let output = '';
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      HOME: homeDirectory,
      USERPROFILE: homeDirectory,
      HOST: '127.0.0.1',
      SERVER_PORT: String(port),
      CLOUDCLI_DISABLE_LOCAL_SERVER_MARKER: '1',
      ...runtimeEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  t.after(async () => {
    await stopChild(child);
    await fs.rm(homeDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });

  const deadline = Date.now() + 20_000;
  let health = null;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // Server startup initializes its database before binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(health, `compiled server did not expose health:\n${output}`);
  assert.equal(health.version, identity.version);
  assert.equal(health.buildId, identity.buildId);
  assert.equal(Number.isInteger(health.pid) && health.pid > 1, true);
  if (expectDirectPid) assert.equal(health.pid, child.pid);
  assert.ok(health.version);
  assert.ok(health.buildId);
  return health;
}

test('source server health exposes the canonical build-start identity', async (t) => {
  const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const identity = JSON.parse(
    await fs.readFile(path.join(rootDir, '.build-identity', 'build-identity.json'), 'utf8'),
  );

  await readHealthFromServer(t, {
    command: process.execPath,
    args: ['--import', 'tsx', 'server/index.ts'],
    cwd: rootDir,
    identity,
    runtimeEnv: { TSX_TSCONFIG_PATH: 'server/tsconfig.json' },
  });
});

test('compiled server health exposes the exact non-empty embedded identity', async (t) => {
  const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const serverEntry = path.join(rootDir, 'dist-server', 'server', 'index.js');
  await fs.access(serverEntry);
  const identity = JSON.parse(
    await fs.readFile(path.join(rootDir, 'dist-server', 'build-identity.json'), 'utf8'),
  );
  const distributionIdentity = JSON.parse(
    await fs.readFile(path.join(rootDir, 'dist', 'build-identity.json'), 'utf8'),
  );
  assert.deepEqual(distributionIdentity, identity);
  const legacyBuildId = (
    await fs.readFile(path.join(rootDir, 'dist', 'build-id.txt'), 'utf8')
  ).trim();
  assert.equal(legacyBuildId, identity.buildId);
  const clientAssetsDirectory = path.join(rootDir, 'dist', 'assets');
  const clientAssetNames = (await fs.readdir(clientAssetsDirectory))
    .filter((name) => name.endsWith('.js'));
  const clientJavaScript = (
    await Promise.all(clientAssetNames.map((name) => (
      fs.readFile(path.join(clientAssetsDirectory, name), 'utf8')
    )))
  ).join('\n');
  assert.match(clientJavaScript, new RegExp(identity.buildId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  await readHealthFromServer(t, {
    command: process.execPath,
    args: [serverEntry],
    cwd: rootDir,
    identity,
  });
});

test('packaged embedded archive starts with the same immutable health identity', async (t) => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    t.skip('This packaged-runtime smoke consumes the macOS arm64 artifact built in the release gate.');
    return;
  }
  const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const resourcesRoot = path.join(
    rootDir,
    'release',
    'desktop',
    'mac-arm64',
    'CloudCLI.app',
    'Contents',
    'Resources',
  );
  try {
    await fs.access(resourcesRoot);
  } catch {
    t.skip('Build the macOS arm64 package before running the packaged-runtime smoke.');
    return;
  }
  const embeddedDirectory = path.join(resourcesRoot, 'embedded-server');
  const archiveName = (await fs.readdir(embeddedDirectory))
    .find((name) => name.endsWith('.tar.gz'));
  assert.ok(archiveName, 'packaged embedded server archive is missing');
  const extractRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-packaged-health-'));
  t.after(() => fs.rm(extractRoot, { recursive: true, force: true }));
  await execFileAsync('tar', ['-xzf', path.join(embeddedDirectory, archiveName), '-C', extractRoot]);
  const identity = JSON.parse(
    await fs.readFile(path.join(extractRoot, 'dist-server', 'build-identity.json'), 'utf8'),
  );
  const packagedIdentity = JSON.parse(
    await fs.readFile(path.join(resourcesRoot, 'app', 'dist', 'build-identity.json'), 'utf8'),
  );
  assert.deepEqual(identity, packagedIdentity);

  await readHealthFromServer(t, {
    command: path.join(resourcesRoot, '..', 'MacOS', 'CloudCLI'),
    args: [path.join(extractRoot, 'dist-server', 'server', 'index.js')],
    cwd: extractRoot,
    identity,
    runtimeEnv: { ELECTRON_RUN_AS_NODE: '1' },
  });
});
