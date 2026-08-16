import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [preloadSource, launcherSource, mainSource, productConfig] = await Promise.all([
  readFile(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../../electron/launcher/launcher.js', import.meta.url), 'utf8'),
  readFile(new URL('../../electron/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../../shared/product-config.json', import.meta.url), 'utf8').then(JSON.parse),
]);

test('default preload omits every Cloud capability', () => {
  const exposed = {};
  const ipcRenderer = { invoke() {}, on() {}, removeListener() {} };
  const window = { location: { protocol: 'file:', hostname: '' } };

  vm.runInNewContext(preloadSource, {
    Object,
    require(id) {
      if (id === 'electron') return { contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } }, ipcRenderer };
      if (id.endsWith('product-config.json')) return productConfig;
      throw new Error(`Unexpected require: ${id}`);
    },
    window,
  });

  assert.deepEqual(Object.keys(exposed.cloudcliDesktop).sort(), [
    'closeSettingsWindow',
    'configureLanAccess',
    'copyDiagnostics',
    'copyLocalWebUrl',
    'getState',
    'onLauncherCommand',
    'onStateUpdated',
    'openLocal',
    'openLocalWebUi',
    'refreshActiveTab',
    'restartAndRepairLocal',
    'showDesktopSettings',
    'showEnvironmentPicker',
    'showLauncher',
    'showLocalSettings',
    'updateSetting',
  ]);
});

test('default launcher renders local UI with no Cloud account or environment surface', () => {
  const document = { addEventListener() {}, readyState: 'loading' };
  const window = {
    __APP_VERSION__: 'test',
    __MOCK_STATE__: {},
    location: { href: 'file:///CloudCLI/electron/launcher/index.html', search: '' },
    matchMedia: () => ({ matches: false }),
  };

  vm.runInNewContext(launcherSource, {
    URL,
    URLSearchParams,
    clearInterval,
    console,
    document,
    navigator: { platform: 'MacIntel', userAgent: 'Mac OS X' },
    Promise,
    setInterval,
    setTimeout,
    window,
  });

  const state = {
    productName: 'CloudCLI',
    features: productConfig.features,
    account: { connected: false },
    activeTarget: { kind: 'launcher' },
    desktopSettings: {},
    environments: [],
    localServerRunning: false,
  };
  const html = window.CC.titlebar(state) + window.CC._reg.renderBody(state);
  assert.match(html, /Open Local Workspace/);
  assert.doesNotMatch(html, /Cloud environments|Connect account|Logout|data-cc-action="connect"/);
});

test('default Electron bootstrap guards account loading and Cloud refresh', () => {
  assert.match(mainSource, /if \(CLOUD_ENABLED\) await cloud\.loadCloudAccount\(\)/);
  assert.match(mainSource, /if \(CLOUD_ENABLED\) void refreshCloudEnvironments/);
  assert.match(mainSource, /if \(CLOUD_ENABLED\) \{[\s\S]*cloudcli-desktop:connect-cloud/);
});
