import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [
  launcherSource,
  launcherCss,
  mainSource,
  viewHostSource,
  desktopWindowSource,
  tabSwitcherSource,
] =
  await Promise.all([
    readFile(new URL('../../electron/launcher/launcher.js', import.meta.url), 'utf8'),
    readFile(new URL('../../electron/launcher/launcher.css', import.meta.url), 'utf8'),
    readFile(new URL('../../electron/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../electron/viewHost.js', import.meta.url), 'utf8'),
    readFile(new URL('../../electron/desktopWindow.js', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../../src/components/main-content/view/subcomponents/MainContentTabSwitcher.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);

function loadLauncher() {
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
  return window.CC;
}

function localState(overrides = {}) {
  return {
    productName: 'CloudCLI',
    features: { cloud: false, hosted: false, pro: false },
    account: { connected: false },
    activeTarget: { kind: 'launcher' },
    desktopSettings: {},
    environments: [],
    localServerRunning: false,
    localStartupLogs: [],
    localStartupFailure: null,
    ...overrides,
  };
}

test('default Desktop launcher has one local primary CTA and no account surface', () => {
  const launcher = loadLauncher();
  const state = localState();
  const html = launcher.titlebar(state) + launcher._reg.renderBody(state);

  assert.equal((html.match(/class="btn pri"/g) || []).length, 1);
  assert.match(html, /data-cc-action="local"[^>]*>[\s\S]*Open Local Workspace/);
  assert.doesNotMatch(
    html,
    /Cloud environments|Hosted|Connect account|Reconnect account|Logout|data-cc-action="connect"/i,
  );
});

test('startup failure preserves logs and offers only Retry as the primary recovery', () => {
  const launcher = loadLauncher();
  const html = launcher._reg.renderBody(localState({
    localStartupFailure: { kind: 'startup', message: 'Server did not become ready.' },
    localStartupLogs: ['Starting bundled runtime', 'Port retry completed'],
  }));

  assert.equal((html.match(/class="btn pri"/g) || []).length, 1);
  assert.match(html, /class="btn pri" data-cc-action="retry-local"[\s\S]*Retry/);
  assert.match(html, /class="btn" data-cc-action="diagnostics"[\s\S]*Copy diagnostics/);
  assert.match(html, /Startup details/);
  assert.match(html, /Starting bundled runtime/);
  assert.match(html, /Port retry completed/);
  assert.doesNotMatch(html, /Open Local Workspace/);
});

test('workspace startup renders the three truthful stages in order', () => {
  const labels = [
    'Starting local server',
    'Checking compatibility',
    'Opening workspace',
  ];
  let previousLabelIndex = -1;
  for (const label of labels) {
    const index = viewHostSource.indexOf(label);
    assert.ok(index > previousLabelIndex, `${label} must follow the previous startup stage`);
    previousLabelIndex = index;
  }

  const openLocalStart = mainSource.indexOf('async function openLocalInDesktop');
  const openLocalEnd = mainSource.indexOf('async function openEnvironmentInDesktop');
  const openLocalSource = mainSource.slice(openLocalStart, openLocalEnd);
  const stageCalls = [
    "showStartupStage('starting-local-server')",
    "showStartupStage('checking-compatibility')",
    "showStartupStage('opening-workspace')",
  ];
  let previousCallIndex = -1;
  for (const call of stageCalls) {
    const index = openLocalSource.indexOf(call);
    assert.ok(index > previousCallIndex, `${call} must follow the previous stage`);
    previousCallIndex = index;
  }
  assert.match(viewHostSource, /aria-live="polite"/);
  assert.match(viewHostSource, /@media\(max-width:640px\)/);
  assert.match(launcherCss, /@media \(max-width: 760px\)[\s\S]*min-height: 44px/);
  assert.match(launcherCss, /button:focus-visible,[\s\S]*var\(--brand-2\)/);
  assert.doesNotMatch(launcherCss, /var\(--(?:accent|tx1)\)/);
});

test('healthy Desktop startup bypasses the launcher and guards one awaited local open', () => {
  const createWindowStart = mainSource.indexOf('async function createDesktopWindow');
  const createWindowEnd = mainSource.indexOf('function registerSingleInstance');
  const createWindowSource = mainSource.slice(createWindowStart, createWindowEnd);
  assert.match(
    createWindowSource,
    /localServer\.getRuntimeMode\(\) === 'desktop-local'[\s\S]*createWindow\(\{ showLauncher: !autoOpenLocalWorkspace \}\);[\s\S]*if \(!autoOpenLocalWorkspace\) return;[\s\S]*await openLocalInDesktop\(\);/,
  );

  const registerEventsStart = mainSource.indexOf('function registerAppEvents');
  const registerEventsEnd = mainSource.indexOf('async function createDesktopWindow');
  const registerEventsSource = mainSource.slice(registerEventsStart, registerEventsEnd);
  assert.match(
    registerEventsSource,
    /app\.on\('activate'[\s\S]*localServer\.getRuntimeMode\(\) === 'desktop-local'[\s\S]*createWindow\(\{ showLauncher: !autoOpenLocalWorkspace \}\)[\s\S]*autoOpenLocalWorkspace \? openLocalInDesktop\(\) : undefined/,
  );

  const openLocalStart = mainSource.indexOf('async function openLocalInDesktop');
  const openLocalEnd = mainSource.indexOf('async function openEnvironmentInDesktop');
  const openLocalSource = mainSource.slice(openLocalStart, openLocalEnd);
  const recoveryTry = openLocalSource.indexOf('try {');
  assert.ok(recoveryTry < openLocalSource.indexOf("tabs.getTab('local')"));
  assert.ok(recoveryTry < openLocalSource.indexOf("showStartupStage('starting-local-server')"));
  assert.match(openLocalSource, /if \(localOpenInFlight\) return localOpenInFlight;/);
  assert.match(openLocalSource, /localOpenInFlight = operation;/);
  assert.match(openLocalSource, /if \(localOpenInFlight === operation\) localOpenInFlight = null;/);
  assert.match(openLocalSource, /catch \(error\)[\s\S]*await desktopWindow\.showLauncher\(\);/);
});

test('LAN menu opens the credentialed setup flow instead of toggling a raw setting', () => {
  assert.match(desktopWindowSource, /Set Up LAN Access/);
  assert.match(desktopWindowSource, /this\.actions\.showLocalSettings\(\)/);
  assert.doesNotMatch(
    desktopWindowSource,
    /updateDesktopSetting\('exposeLocalServerOnNetwork'/,
  );
});

test('workspace navigation groups overflow when more than seven tabs exist', () => {
  assert.match(tabSwitcherSource, /MAX_UNGROUPED_TABS = 7/);
  assert.match(tabSwitcherSource, /tabs\.length > MAX_UNGROUPED_TABS/);
  assert.match(tabSwitcherSource, /VISIBLE_TABS_WITH_OVERFLOW/);
  assert.match(tabSwitcherSource, /<ActionMenu/);
  assert.match(tabSwitcherSource, /More workspace tools/);
  assert.match(tabSwitcherSource, /ariaLabel=\{displayLabel\}/);
  assert.equal((tabSwitcherSource.match(/min-h-11 min-w-11/g) || []).length, 2);
  assert.match(tabSwitcherSource, /max-w-full overflow-x-auto/);
});
