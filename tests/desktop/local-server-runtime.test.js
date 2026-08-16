import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LocalServerController } from '../../electron/localServer.js';

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function startStaleManagedServer(appRoot, { shutdownMode = 'accept' } = {}) {
  const scriptPath = path.join(appRoot, 'stale-server.cjs');
  await fs.writeFile(scriptPath, `
    const http = require('node:http');
    const crypto = require('node:crypto');
    const shutdownMode = ${JSON.stringify(shutdownMode)};
    const server = http.createServer((request, response) => {
      if (request.method === 'POST' && request.url === '/desktop/shutdown') {
        if (request.headers['x-cloudcli-desktop-owner-nonce'] !== 'stale-owner-nonce') {
          response.statusCode = 404; response.end(); return;
        }
        if (shutdownMode === 'reject') { response.statusCode = 404; response.end(); return; }
        response.statusCode = 202; response.end();
        if (shutdownMode === 'accept') {
          setImmediate(() => server.close(() => process.exit(0)));
        }
        return;
      }
      if (request.url !== '/health') { response.statusCode = 404; response.end(); return; }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok',
        installMode: 'npm',
        version: '1.36.0',
        buildId: 'stale-desktop-build',
        runtimeMode: 'desktop-local',
        pid: process.pid,
        desktopLaunchNonce: 'stale-launch-nonce',
        desktopOwnerProof: crypto.createHash('sha256').update('stale-owner-nonce').digest('hex'),
        desktopProcessStartedAt: '2026-01-01T00:00:00.000Z',
      }));
    });
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);
  const child = spawn(process.execPath, [scriptPath], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', (chunk) => resolve(Number.parseInt(String(chunk).trim(), 10)));
  });
  return { child, port };
}

async function startMatchingManagedServer(appRoot) {
  const scriptPath = path.join(appRoot, 'matching-server.cjs');
  await fs.writeFile(scriptPath, `
    const http = require('node:http');
    const crypto = require('node:crypto');
    let ownershipIsValid = true;
    const server = http.createServer((request, response) => {
      if (request.method === 'POST' && request.url === '/invalidate') {
        ownershipIsValid = false; response.statusCode = 204; response.end(); return;
      }
      if (request.method === 'POST' && request.url === '/api/auth/desktop-bootstrap') {
        if (request.headers['x-cloudcli-desktop-session-secret'] !== 'matching-owner-nonce') {
          response.statusCode = 401; response.end(); return;
        }
        response.setHeader('content-type', 'application/json');
        response.setHeader('set-cookie', 'cloudcli_session=reused-session; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800');
        response.end(JSON.stringify({ success: true }));
        return;
      }
      if (request.url !== '/health') { response.statusCode = 404; response.end(); return; }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok', installMode: 'npm', version: '1.37.0', buildId: 'desktop-test-build',
        runtimeMode: 'desktop-local',
        pid: process.pid,
        desktopLaunchNonce: 'matching-launch-nonce',
        desktopOwnerProof: crypto.createHash('sha256').update(ownershipIsValid ? 'matching-owner-nonce' : 'changed-owner-nonce').digest('hex'),
        desktopProcessStartedAt: '2026-02-02T00:00:00.000Z',
      }));
    });
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);
  const child = spawn(process.execPath, [scriptPath], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', (chunk) => resolve(Number.parseInt(String(chunk).trim(), 10)));
  });
  return { child, port };
}

test('desktop prefers its embedded customized server runtime', async (t) => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-desktop-runtime-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  const resourcesRoot = path.join(appRoot, 'Resources');
  const embeddedEntry = path.join(resourcesRoot, 'server-runtime', 'dist-server', 'server', 'index.js');
  await fs.mkdir(path.dirname(embeddedEntry), { recursive: true });
  await fs.writeFile(embeddedEntry, '// customized local server');

  const controller = new LocalServerController({
    appRoot,
    resourcesRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    buildIdentity: { version: '1.37.0', buildId: 'desktop-test-build' },
    onChange() {},
  });

  assert.equal(await controller.resolveServerEntry(), embeddedEntry);
});

test('packaged desktop owns a nonce and build-verified loopback server', async (t) => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-desktop-owned-runtime-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  const entry = path.join(appRoot, 'dist-server', 'server', 'index.js');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, `
    const http = require('node:http');
    const server = http.createServer((request, response) => {
      if (request.url !== '/health') { response.statusCode = 404; response.end(); return; }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok',
        installMode: 'npm',
        version: '1.37.0',
        buildId: 'desktop-test-build',
        runtimeMode: 'desktop-local',
        pid: process.pid,
        desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE || null,
        desktopOwnerProof: require('node:crypto').createHash('sha256').update(process.env.CLOUDCLI_DESKTOP_OWNER_NONCE || '').digest('hex'),
        desktopProcessStartedAt: process.env.CLOUDCLI_DESKTOP_PROCESS_STARTED_AT || null,
      }));
    });
    server.listen(Number(process.env.SERVER_PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);

  const controller = new LocalServerController({
    appRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    buildIdentity: { version: '1.37.0', buildId: 'desktop-test-build' },
    onChange() {},
  });
  t.after(() => controller.shutdownOwnedServer());

  const [url, concurrentUrl] = await Promise.all([
    controller.ensureLocalServer(),
    controller.ensureLocalServer(),
  ]);
  assert.match(url, /^http:\/\/localhost:\d+$/);
  assert.equal(concurrentUrl, url);
  assert.equal(controller.getVerifiedLocalOrigin(), new URL(url).origin);
  assert.equal(controller.hasOwnedServer(), true);
});

test('malformed launched health is classified and restart-and-repair retries successfully', async (t) => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-desktop-invalid-health-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  const entry = path.join(appRoot, 'dist-server', 'server', 'index.js');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, `
    const http = require('node:http');
    const server = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok', installMode: 'npm', pid: process.pid,
        desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE,
      }));
    });
    server.listen(Number(process.env.SERVER_PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);
  const controller = new LocalServerController({
    appRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    buildIdentity: { version: '1.37.0', buildId: 'desktop-test-build' },
    onChange() {},
  });
  t.after(() => controller.shutdownOwnedServer());

  await assert.rejects(
    controller.ensureLocalServer(),
    (error) => error?.code === 'LOCAL_SERVER_COMPATIBILITY'
      && /malformed or incomplete health identity/i.test(error.message),
  );
  await fs.writeFile(entry, `
    const http = require('node:http');
    const crypto = require('node:crypto');
    const server = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok', installMode: 'npm', version: '1.37.0', buildId: 'desktop-test-build',
        runtimeMode: 'desktop-local',
        pid: process.pid, desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE,
        desktopOwnerProof: crypto.createHash('sha256').update(process.env.CLOUDCLI_DESKTOP_OWNER_NONCE).digest('hex'),
        desktopProcessStartedAt: process.env.CLOUDCLI_DESKTOP_PROCESS_STARTED_AT,
      }));
    });
    server.listen(Number(process.env.SERVER_PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);

  const repaired = await controller.restartAndRepair();
  assert.match(repaired, /^http:\/\/localhost:[0-9]+$/);
  assert.equal(controller.hasOwnedServer(), true);
});

test('a listener that wins the selected-port race triggers EADDRINUSE retry', async (t) => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-desktop-port-race-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  const entry = path.join(appRoot, 'dist-server', 'server', 'index.js');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, `
    const http = require('node:http');
    const crypto = require('node:crypto');
    const server = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok', installMode: 'npm', version: '1.37.0', buildId: 'desktop-test-build',
        runtimeMode: 'desktop-local',
        pid: process.pid, desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE,
        desktopOwnerProof: crypto.createHash('sha256').update(process.env.CLOUDCLI_DESKTOP_OWNER_NONCE).digest('hex'),
        desktopProcessStartedAt: process.env.CLOUDCLI_DESKTOP_PROCESS_STARTED_AT,
      }));
    });
    server.listen(Number(process.env.SERVER_PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);
  let chooseCalls = 0;
  let competingServer;
  let claimedPort;
  const choosePort = async () => {
    chooseCalls += 1;
    const port = await reservePort();
    if (chooseCalls === 1) {
      claimedPort = port;
      competingServer = http.createServer((_request, response) => {
        response.setHeader('content-type', 'text/html');
        response.end('<h1>another listener</h1>');
      });
      await new Promise((resolve, reject) => {
        competingServer.once('error', reject);
        competingServer.listen(port, '127.0.0.1', resolve);
      });
    }
    return port;
  };
  t.after(() => new Promise((resolve) => competingServer?.close(resolve) ?? resolve()));
  const logs = [];
  const controller = new LocalServerController({
    appRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    buildIdentity: { version: '1.37.0', buildId: 'desktop-test-build' },
    choosePort,
    onChange() {},
    onLog: (line) => logs.push(line),
  });
  t.after(() => controller.shutdownOwnedServer());

  const url = await controller.ensureLocalServer();

  assert.equal(chooseCalls, 2);
  assert.notEqual(new URL(url).port, String(claimedPort));
  assert.equal(logs.some((line) => /retrying with another loopback port/i.test(line)), true);
});

test('desktop stops only a marker-and-health verified mismatched managed server', async (t) => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-desktop-repair-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  const markerPath = path.join(appRoot, 'local-server.json');
  const { child: staleChild, port: stalePort } = await startStaleManagedServer(appRoot);
  t.after(() => {
    if (staleChild.exitCode === null) staleChild.kill('SIGKILL');
  });
  await fs.writeFile(markerPath, JSON.stringify({
    pid: staleChild.pid,
    url: `http://127.0.0.1:${stalePort}`,
    managedBy: 'cloudcli-desktop',
    version: '1.36.0',
    buildId: 'stale-desktop-build',
    runtimeMode: 'desktop-local',
    desktopLaunchNonce: 'stale-launch-nonce',
    desktopOwnerNonce: 'stale-owner-nonce',
    desktopProcessStartedAt: '2026-01-01T00:00:00.000Z',
  }));

  const entry = path.join(appRoot, 'dist-server', 'server', 'index.js');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, `
    const http = require('node:http');
    const server = http.createServer((request, response) => {
      if (request.url !== '/health') { response.statusCode = 404; response.end(); return; }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok', installMode: 'npm', version: '1.37.0', buildId: 'current-desktop-build',
        runtimeMode: 'desktop-local',
        pid: process.pid,
        desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE || null,
        desktopOwnerProof: require('node:crypto').createHash('sha256').update(process.env.CLOUDCLI_DESKTOP_OWNER_NONCE || '').digest('hex'),
        desktopProcessStartedAt: process.env.CLOUDCLI_DESKTOP_PROCESS_STARTED_AT || null,
      }));
    });
    server.listen(Number(process.env.SERVER_PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);

  const controller = new LocalServerController({
    appRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    buildIdentity: { version: '1.37.0', buildId: 'current-desktop-build' },
    serverMarkerPath: markerPath,
    onChange() {},
  });
  t.after(() => controller.shutdownOwnedServer());

  const url = await controller.ensureLocalServer();
  if (staleChild.exitCode === null) await once(staleChild, 'exit');

  assert.match(url, /^http:\/\/localhost:\d+$/);
  const repairedHealth = await fetch(`${url}/health`).then((response) => response.json());
  assert.equal(repairedHealth.buildId, 'current-desktop-build');
  assert.notEqual(staleChild.exitCode, null);
});

test('desktop treats changed ownership evidence as a stale marker and never signals its PID', async (t) => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-desktop-no-kill-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  const markerPath = path.join(appRoot, 'local-server.json');
  const { child: alienChild, port: alienPort } = await startStaleManagedServer(appRoot);
  t.after(() => {
    if (alienChild.exitCode === null) alienChild.kill('SIGKILL');
  });
  await fs.writeFile(markerPath, JSON.stringify({
    pid: alienChild.pid,
    url: `http://127.0.0.1:${alienPort}`,
    managedBy: 'cloudcli-desktop',
    version: '1.36.0',
    buildId: 'stale-desktop-build',
    runtimeMode: 'desktop-local',
    desktopLaunchNonce: 'stale-launch-nonce',
    desktopOwnerNonce: 'marker-does-not-match-health',
    desktopProcessStartedAt: '2026-01-01T00:00:00.000Z',
  }));

  const entry = path.join(appRoot, 'dist-server', 'server', 'index.js');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, `
    const http = require('node:http');
    const server = http.createServer((request, response) => {
      if (request.url !== '/health') { response.statusCode = 404; response.end(); return; }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok', installMode: 'npm', version: '1.37.0', buildId: 'current-desktop-build',
        runtimeMode: 'desktop-local',
        pid: process.pid,
        desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE || null,
        desktopOwnerProof: require('node:crypto').createHash('sha256').update(process.env.CLOUDCLI_DESKTOP_OWNER_NONCE || '').digest('hex'),
        desktopProcessStartedAt: process.env.CLOUDCLI_DESKTOP_PROCESS_STARTED_AT || null,
      }));
    });
    server.listen(Number(process.env.SERVER_PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);

  const controller = new LocalServerController({
    appRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    buildIdentity: { version: '1.37.0', buildId: 'current-desktop-build' },
    serverMarkerPath: markerPath,
    onChange() {},
  });
  t.after(() => controller.shutdownOwnedServer());

  const url = await controller.ensureLocalServer();

  assert.equal(alienChild.exitCode, null);
  const repairedHealth = await fetch(`${url}/health`).then((response) => response.json());
  assert.equal(repairedHealth.buildId, 'current-desktop-build');
});

test('rejected managed shutdown challenge uses the safe new-port repair path', async (t) => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-desktop-rejected-stop-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  const markerPath = path.join(appRoot, 'local-server.json');
  const { child: staleChild, port: stalePort } = await startStaleManagedServer(
    appRoot,
    { shutdownMode: 'reject' },
  );
  t.after(() => { if (staleChild.exitCode === null) staleChild.kill('SIGKILL'); });
  await fs.writeFile(markerPath, JSON.stringify({
    pid: staleChild.pid,
    url: `http://localhost:${stalePort}`,
    managedBy: 'cloudcli-desktop',
    version: '1.36.0',
    buildId: 'stale-desktop-build',
    runtimeMode: 'desktop-local',
    desktopLaunchNonce: 'stale-launch-nonce',
    desktopOwnerNonce: 'stale-owner-nonce',
    desktopProcessStartedAt: '2026-01-01T00:00:00.000Z',
  }));
  const entry = path.join(appRoot, 'dist-server', 'server', 'index.js');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, `
    const http = require('node:http');
    const crypto = require('node:crypto');
    const server = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok', installMode: 'npm', version: '1.37.0', buildId: 'current-desktop-build',
        runtimeMode: 'desktop-local',
        pid: process.pid, desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE,
        desktopOwnerProof: crypto.createHash('sha256').update(process.env.CLOUDCLI_DESKTOP_OWNER_NONCE).digest('hex'),
        desktopProcessStartedAt: process.env.CLOUDCLI_DESKTOP_PROCESS_STARTED_AT,
      }));
    });
    server.listen(Number(process.env.SERVER_PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);
  const controller = new LocalServerController({
    appRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    buildIdentity: { version: '1.37.0', buildId: 'current-desktop-build' },
    serverMarkerPath: markerPath,
    onChange() {},
  });
  t.after(() => controller.shutdownOwnedServer());

  const repaired = await controller.ensureLocalServer();

  assert.equal(staleChild.exitCode, null);
  assert.notEqual(new URL(repaired).port, String(stalePort));
  assert.equal(controller.hasOwnedServer(), true);
});

test('accepted shutdown that never terminates becomes a compatibility timeout', async (t) => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-desktop-stop-timeout-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  const { child, port } = await startStaleManagedServer(appRoot, { shutdownMode: 'ignore' });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const candidateUrl = `http://127.0.0.1:${port}`;
  const marker = {
    pid: child.pid,
    url: `http://localhost:${port}`,
    managedBy: 'cloudcli-desktop',
    version: '1.36.0',
    buildId: 'stale-desktop-build',
    runtimeMode: 'desktop-local',
    desktopLaunchNonce: 'stale-launch-nonce',
    desktopOwnerNonce: 'stale-owner-nonce',
    desktopProcessStartedAt: '2026-01-01T00:00:00.000Z',
  };
  const health = await fetch(`${candidateUrl}/health`).then((response) => response.json());
  const controller = new LocalServerController({
    appRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    buildIdentity: { version: '1.37.0', buildId: 'current-desktop-build' },
    onChange() {},
  });

  await assert.rejects(
    controller.stopMismatchedManagedServer(marker, health, candidateUrl),
    (error) => error?.code === 'LOCAL_SERVER_COMPATIBILITY'
      && /did not stop in time/i.test(error.message),
  );
});

test('matching managed server reuse survives localhost and loopback alias rechecks', async (t) => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-desktop-reuse-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  const markerPath = path.join(appRoot, 'local-server.json');
  const { child, port } = await startMatchingManagedServer(appRoot);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await fs.writeFile(markerPath, JSON.stringify({
    pid: child.pid,
    url: `http://localhost:${port}`,
    managedBy: 'cloudcli-desktop',
    version: '1.37.0',
    buildId: 'desktop-test-build',
    runtimeMode: 'desktop-local',
    desktopLaunchNonce: 'matching-launch-nonce',
    desktopOwnerNonce: 'matching-owner-nonce',
    desktopProcessStartedAt: '2026-02-02T00:00:00.000Z',
  }));
  const controller = new LocalServerController({
    appRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    buildIdentity: { version: '1.37.0', buildId: 'desktop-test-build' },
    serverMarkerPath: markerPath,
    onChange() {},
  });

  const first = await controller.ensureLocalServer();
  const second = await controller.ensureLocalServer();
  const cookieWrites = [];
  const bootstrap = await controller.bootstrapLocalSession({
    cookies: { set: async (cookie) => { cookieWrites.push(cookie); } },
  });

  assert.equal(first, `http://localhost:${port}`);
  assert.equal(second, first);
  assert.equal(controller.getDesktopSessionSecret(), 'matching-owner-nonce');
  assert.deepEqual(bootstrap, { success: true });
  assert.equal(cookieWrites[0].value, 'reused-session');
  assert.equal(child.exitCode, null);
});

test('cached target recheck rejects changed ownership even when identity still matches', async (t) => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-desktop-recheck-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  const markerPath = path.join(appRoot, 'local-server.json');
  const { child, port } = await startMatchingManagedServer(appRoot);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await fs.writeFile(markerPath, JSON.stringify({
    pid: child.pid,
    url: `http://localhost:${port}`,
    managedBy: 'cloudcli-desktop',
    version: '1.37.0',
    buildId: 'desktop-test-build',
    runtimeMode: 'desktop-local',
    desktopLaunchNonce: 'matching-launch-nonce',
    desktopOwnerNonce: 'matching-owner-nonce',
    desktopProcessStartedAt: '2026-02-02T00:00:00.000Z',
  }));
  const entry = path.join(appRoot, 'dist-server', 'server', 'index.js');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, `
    const http = require('node:http');
    const crypto = require('node:crypto');
    const server = http.createServer((request, response) => {
      if (request.url !== '/health') { response.statusCode = 404; response.end(); return; }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'ok', installMode: 'npm', version: '1.37.0', buildId: 'desktop-test-build',
        runtimeMode: 'desktop-local',
        pid: process.pid,
        desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE,
        desktopOwnerProof: crypto.createHash('sha256').update(process.env.CLOUDCLI_DESKTOP_OWNER_NONCE).digest('hex'),
        desktopProcessStartedAt: process.env.CLOUDCLI_DESKTOP_PROCESS_STARTED_AT,
      }));
    });
    server.listen(Number(process.env.SERVER_PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);
  const controller = new LocalServerController({
    appRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    buildIdentity: { version: '1.37.0', buildId: 'desktop-test-build' },
    serverMarkerPath: markerPath,
    onChange() {},
  });
  t.after(() => controller.shutdownOwnedServer());
  const first = await controller.ensureLocalServer();
  await fetch(`http://127.0.0.1:${port}/invalidate`, { method: 'POST' });

  const repaired = await controller.ensureLocalServer();

  assert.equal(first, `http://localhost:${port}`);
  assert.notEqual(repaired, first);
  assert.equal(controller.hasOwnedServer(), true);
});
