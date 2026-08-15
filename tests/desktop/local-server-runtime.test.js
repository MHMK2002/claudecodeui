import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LocalServerController } from '../../electron/localServer.js';

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
    appVersion: null,
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
        buildId: 'desktop-test-build',
        desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE || null,
      }));
    });
    server.listen(Number(process.env.SERVER_PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);

  const controller = new LocalServerController({
    appRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    appVersion: 'test',
    buildId: 'desktop-test-build',
    onChange() {},
  });
  t.after(() => controller.shutdownOwnedServer());

  const url = await controller.ensureLocalServer();
  assert.match(url, /^http:\/\/localhost:\d+$/);
  assert.equal(controller.getVerifiedLocalOrigin(), new URL(url).origin);
  assert.equal(controller.hasOwnedServer(), true);
});
