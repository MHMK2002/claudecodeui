import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LocalServerController } from '../../electron/localServer.js';

test('Electron bootstraps an HttpOnly cookie and returns no renderer token', async (t) => {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-local-session-'));
  t.after(() => fs.rm(appRoot, { recursive: true, force: true }));
  const entry = path.join(appRoot, 'dist-server', 'server', 'index.js');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, `
    const crypto = require('node:crypto');
    const http = require('node:http');
    const server = http.createServer((request, response) => {
      if (request.url === '/health') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          status: 'ok', installMode: 'npm', version: '1.37.0', buildId: 'desktop-session-test',
          runtimeMode: process.env.CLOUDCLI_RUNTIME_MODE, pid: process.pid,
          desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE,
          desktopOwnerProof: crypto.createHash('sha256').update(process.env.CLOUDCLI_DESKTOP_OWNER_NONCE).digest('hex'),
          desktopProcessStartedAt: process.env.CLOUDCLI_DESKTOP_PROCESS_STARTED_AT,
        }));
        return;
      }
      if (request.method === 'POST' && request.url === '/api/auth/desktop-bootstrap') {
        if (request.headers['x-cloudcli-desktop-session-secret'] !== process.env.CLOUDCLI_DESKTOP_OWNER_NONCE) {
          response.statusCode = 401; response.end(); return;
        }
        if (!/^[a-f0-9]{64}$/.test(request.headers['x-cloudcli-desktop-session-nonce'] || '')) {
          response.statusCode = 400; response.end(); return;
        }
        response.setHeader('content-type', 'application/json');
        response.setHeader('set-cookie', 'cloudcli_session=signed-session; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800');
        response.end(JSON.stringify({ success: true }));
        return;
      }
      if (request.method === 'POST' && request.url === '/api/auth/desktop-handoff') {
        const nonce = request.headers['x-cloudcli-desktop-session-nonce'];
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ path: '/api/auth/desktop-handoff/' + nonce }));
        return;
      }
      if (request.method === 'POST' && request.url === '/api/auth/desktop-lan-credentials') {
        let body = '';
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
          const credentials = JSON.parse(body || '{}');
          if (request.headers['x-cloudcli-desktop-session-secret'] !== process.env.CLOUDCLI_DESKTOP_OWNER_NONCE
              || credentials.username !== 'lan-owner'
              || credentials.password !== 'safe-password') {
            response.statusCode = 400; response.end(); return;
          }
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ success: true, username: credentials.username }));
        });
        return;
      }
      response.statusCode = 404; response.end();
    });
    server.listen(Number(process.env.SERVER_PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);

  const controller = new LocalServerController({
    appRoot,
    settingsPath: path.join(appRoot, 'settings.json'),
    isPackaged: true,
    buildIdentity: { version: '1.37.0', buildId: 'desktop-session-test' },
    desktopOwnerNonce: 'test-owner-secret',
    onChange() {},
  });
  t.after(() => controller.shutdownOwnedServer());

  const cookieWrites = [];
  const electronSession = {
    cookies: {
      set: async (cookie) => { cookieWrites.push(cookie); },
    },
  };

  await controller.ensureLocalServer();
  assert.equal(controller.getDesktopSessionSecret(), 'test-owner-secret');
  const result = await controller.bootstrapLocalSession(electronSession);

  assert.deepEqual(result, { success: true });
  assert.equal('token' in result, false);
  assert.equal(cookieWrites.length, 1);
  assert.deepEqual(
    {
      name: cookieWrites[0].name,
      value: cookieWrites[0].value,
      path: cookieWrites[0].path,
      httpOnly: cookieWrites[0].httpOnly,
      sameSite: cookieWrites[0].sameSite,
    },
    {
      name: 'cloudcli_session',
      value: 'signed-session',
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
    },
  );

  const handoffUrl = await controller.createBrowserHandoffUrl();
  const parsedHandoff = new URL(handoffUrl);
  assert.match(parsedHandoff.pathname, /^\/api\/auth\/desktop-handoff\/[a-f0-9]{64}$/);
  assert.equal(parsedHandoff.search, '');
  assert.doesNotMatch(handoffUrl, /token|signed-session|jwt/i);

  const enabled = await controller.configureLanAccess(electronSession, {
    enabled: true,
    username: 'lan-owner',
    password: 'safe-password',
  });
  assert.equal(enabled.runtimeMode, 'desktop-lan');
  assert.equal(enabled.restarted, true);
  assert.equal(controller.getSettings().exposeLocalServerOnNetwork, true);
  assert.equal(controller.getRuntimeMode(), 'desktop-lan');
  const lanOwnerSecret = controller.getDesktopSessionSecret();
  assert.notEqual(lanOwnerSecret, 'test-owner-secret');

  const disabled = await controller.configureLanAccess(electronSession, { enabled: false });
  assert.equal(disabled.runtimeMode, 'desktop-local');
  assert.equal(disabled.restarted, true);
  assert.equal(controller.getSettings().exposeLocalServerOnNetwork, false);
  assert.equal(controller.getRuntimeMode(), 'desktop-local');
  assert.notEqual(controller.getDesktopSessionSecret(), lanOwnerSecret);
});
