import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const launcherSource = await readFile(
  new URL('../../electron/launcher/launcher.js', import.meta.url),
  'utf8',
);

function loadLauncher() {
  const document = {
    addEventListener() {},
    readyState: 'loading',
  };
  const window = {
    __APP_VERSION__: 'test',
    __MOCK_STATE__: {},
    location: {
      href: 'file:///CloudCLI/electron/launcher/index.html',
      search: '',
    },
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

  return window.CC;
}

test('desktop titlebar does not expose tab navigation', () => {
  const launcher = loadLauncher();
  const titlebar = launcher.titlebar({
    account: { connected: false },
    activeTarget: { kind: 'local', name: 'Local CloudCLI' },
    tabs: [
      { id: 'home', title: 'Launcher', active: false, closable: false },
      { id: 'local', title: 'Local CloudCLI', active: true, closable: true },
    ],
  });

  assert.doesNotMatch(titlebar, /data-cc-tab|data-cc-close-tab|tb-tabs|tb-tab/);
  assert.match(titlebar, /CloudCLI/);
  assert.match(titlebar, /title="Refresh"/);
});
