import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const preloadSource = await readFile(
  new URL('../../electron/preload.cjs', import.meta.url),
  'utf8',
);

function runPreload({ protocol = 'http:', hostname }) {
  const exposed = new Map();
  const invoked = [];
  const invocationArguments = [];
  const ipcRenderer = {
    invoke(channel, ...args) {
      invoked.push(channel);
      invocationArguments.push({ channel, args });
      return Promise.resolve({ success: true });
    },
    on() {},
    removeListener() {},
  };

  vm.runInNewContext(preloadSource, {
    require: (request) => {
      if (request === '../shared/product-config.json') {
        return { features: { cloud: false } };
      }
      if (request === 'electron') {
        return {
          contextBridge: {
            exposeInMainWorld(name, value) {
              exposed.set(name, value);
            },
          },
          ipcRenderer,
        };
      }
      throw new Error(`Unexpected preload dependency: ${request}`);
    },
    window: { location: { protocol, hostname } },
  });

  return { exposed, invoked, invocationArguments };
}

test('preload exposes only tokenless local-session renewal on loopback app pages', async () => {
  for (const hostname of ['localhost', '127.0.0.1']) {
    const runtime = runPreload({ hostname });
    const bridge = runtime.exposed.get('cloudcliDesktopLocalSession');

    assert.deepEqual(Object.keys(bridge), ['renew']);
    assert.deepEqual(await bridge.renew(), { success: true });
    assert.deepEqual(runtime.invoked, ['cloudcli-desktop:renew-local-session']);
  }
});

test('preload exposes no local-session authority to remote origins', () => {
  const runtime = runPreload({ protocol: 'https:', hostname: 'example.com' });

  assert.equal(runtime.exposed.has('cloudcliDesktopLocalSession'), false);
  assert.equal(runtime.exposed.has('cloudcliDesktopPdf'), false);
  assert.deepEqual(runtime.invoked, []);
});

test('preload exposes the PDF bridge only on loopback workspace pages', async () => {
  const localRuntime = runPreload({ hostname: '127.0.0.1' });
  const bridge = localRuntime.exposed.get('cloudcliDesktopPdf');
  const payload = { html: '<!doctype html><p>Safe</p>', suggestedFilename: 'chat.pdf' };

  assert.deepEqual(Object.keys(bridge), ['exportPdf']);
  assert.deepEqual(await bridge.exportPdf(payload), { success: true });
  assert.deepEqual(localRuntime.invoked, ['cloudcli-desktop:export-pdf']);
  assert.deepEqual(localRuntime.invocationArguments, [{
    channel: 'cloudcli-desktop:export-pdf',
    args: [payload],
  }]);

  const launcherRuntime = runPreload({ protocol: 'file:', hostname: '' });
  assert.equal(launcherRuntime.exposed.has('cloudcliDesktopPdf'), false);
});

test('preload exposes the desktop updater bridge only on loopback workspace pages', async () => {
  const localRuntime = runPreload({ hostname: '127.0.0.1' });
  const bridge = localRuntime.exposed.get('cloudcliDesktopUpdater');

  assert.deepEqual(Object.keys(bridge), [
    'getState',
    'check',
    'restartAndInstall',
    'onStateChanged',
  ]);
  await bridge.getState();
  await bridge.check();
  await bridge.restartAndInstall();
  assert.deepEqual(localRuntime.invoked, [
    'cloudcli-desktop:updater-get-state',
    'cloudcli-desktop:updater-check',
    'cloudcli-desktop:updater-restart-and-install',
  ]);

  const launcherRuntime = runPreload({ protocol: 'file:', hostname: '' });
  const remoteRuntime = runPreload({ protocol: 'https:', hostname: 'example.com' });
  assert.equal(launcherRuntime.exposed.has('cloudcliDesktopUpdater'), false);
  assert.equal(remoteRuntime.exposed.has('cloudcliDesktopUpdater'), false);
});

test('preload no longer reads, writes, or polls renderer token storage', () => {
  assert.doesNotMatch(preloadSource, /localStorage|auth-token|get-local-auth-token|update-local-auth-token/);
  assert.doesNotMatch(preloadSource, /setInterval/);
});
