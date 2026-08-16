import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
  assertBuildIdentity,
  buildIdentitiesMatch,
  serializeBuildIdentity,
} from '../../shared/buildIdentity.js';

test('launcher version and service-worker caches are derived from build artifacts', async () => {
  const [launcher, serviceWorker, clientEntry, htmlEntry, serverEntry, identityService, prepareScript, bundleScript, viteConfig] = await Promise.all([
    readFile(new URL('../../electron/launcher/launcher.js', import.meta.url), 'utf8'),
    readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/main.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../server/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../server/modules/system/build-identity.service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/release/prepare-desktop-app.js', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/release/build-server-bundle.js', import.meta.url), 'utf8'),
    readFile(new URL('../../vite.config.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(launcher, /__APP_VERSION__\s*=\s*['"]\d/);
  assert.match(launcher, /state\.appVersion/);
  assert.match(serviceWorker, /cloudcli-web-/);
  assert.match(serviceWorker, /searchParams\.get\('build'\)/);
  assert.match(serviceWorker, /const EMBEDDED_BUILD_ID = null/);
  assert.doesNotMatch(serviceWorker, /filter\(name => name !== CACHE_NAME\)\s*\.map/);
  assert.doesNotMatch(serviceWorker, /caches\.match\(event\.request\)/);
  assert.match(serviceWorker, /cloudcli:build-activated/);
  assert.match(serviceWorker, /pathname === '\/health'/);
  assert.match(clientEntry, /sw\.js\?build=/);
  assert.match(clientEntry, /updateViaCache:\s*'none'/);
  assert.match(clientEntry, /import\.meta\.env\.PROD/);
  assert.match(clientEntry, /getRegistrations\(\)/);
  assert.match(clientEntry, /cloudcli:build-activated/);
  assert.doesNotMatch(htmlEntry, /serviceWorker\.register/);
  assert.match(serverEntry, /loadServerBuildIdentity/);
  assert.match(identityService, /build-identity\.json/);
  assert.doesNotMatch(serverEntry, /return\s+[`'"][^\n]*unidentified/);
  assert.match(serverEntry, /desktopLaunchNonce/);
  assert.match(serverEntry, /desktopOwnerNonce/);
  assert.match(viteConfig, /build-identity\.json/);
  assert.match(viteConfig, /serviceWorkerSource\.replace/);
  assert.match(bundleScript, /canonicalIdentity/);
  assert.match(bundleScript, /service worker identity differs/i);
  assert.match(bundleScript, /electronRebuild[\s\S]*cwd: stageDir/);
  assert.match(prepareScript, /inspectArchive/);
  assert.ok(
    prepareScript.indexOf('build-server-bundle.js') < prepareScript.indexOf("copyRequired('dist')"),
    'desktop staging must copy web assets after creating the embedded server bundle',
  );
});

test('an existing old-query service-worker registration activates the new embedded build', async () => {
  const source = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');
  const activatedMessages = [];
  const listeners = {};
  const self = {
    location: { href: 'https://cloudcli.test/sw.js?build=build-A' },
    addEventListener(type, listener) { listeners[type] = listener; },
    skipWaiting() {},
    clients: {
      claim() {},
      matchAll: async () => [{ postMessage: (message) => activatedMessages.push(message) }],
    },
    registration: { showNotification() {} },
  };
  const caches = {
    keys: async () => ['cloudcli-web-build-A'],
    delete: async () => true,
    open: async () => ({ addAll: async () => {}, match: async () => null, put: async () => {} }),
    match: async () => null,
  };
  const builtSource = source.replace(
    'const EMBEDDED_BUILD_ID = null;',
    "const EMBEDDED_BUILD_ID = 'build-B';",
  );
  vm.runInNewContext(builtSource, {
    self,
    caches,
    URL,
    Response,
    fetch: async () => ({ ok: true, clone() { return this; } }),
    Promise,
  });
  let activation;
  listeners.activate({ waitUntil(value) { activation = value; } });
  await activation;

  assert.equal(activatedMessages.length, 1);
  assert.equal(activatedMessages[0].type, 'cloudcli:build-activated');
  assert.equal(activatedMessages[0].buildId, 'build-B');
});

test('build identity validation rejects empty, synthetic, and mismatched identities', () => {
  assert.throws(
    () => assertBuildIdentity({ version: '', buildId: 'valid-build' }),
    /invalid or empty version/i,
  );
  assert.throws(
    () => assertBuildIdentity({ version: '1.37.0', buildId: '1.37.0-unidentified' }),
    /synthetic buildId/i,
  );
  assert.throws(
    () => assertBuildIdentity(
      { version: '1.36.0', buildId: 'valid-build' },
      { expectedVersion: '1.37.0' },
    ),
    /does not match package version/i,
  );
  assert.throws(
    () => assertBuildIdentity(
      { version: '1.37.0', buildId: 'valid-build' },
      { expectedVersion: '' },
    ),
    /expected package version is invalid or empty/i,
  );
});

test('canonical serialization preserves the same version and buildId', () => {
  const identity = { version: '1.37.0', buildId: 'immutable-build-123' };
  const serialized = serializeBuildIdentity(identity);
  assert.deepEqual(JSON.parse(serialized), identity);
  assert.equal(buildIdentitiesMatch(JSON.parse(serialized), identity), true);
});

test('compatibility failure exposes one repair primary action and diagnostics secondary action', async () => {
  const [launcher, main, preload] = await Promise.all([
    readFile(new URL('../../electron/launcher/launcher.js', import.meta.url), 'utf8'),
    readFile(new URL('../../electron/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'),
  ]);

  assert.match(launcher, /class=\"btn pri\" data-cc-action=\"restart-repair\"/);
  assert.match(launcher, /class=\"btn\" data-cc-action=\"diagnostics\"/);
  assert.equal((launcher.match(/data-cc-action=\"restart-repair\"/g) || []).length, 1);
  assert.match(main, /cloudcli-desktop:restart-and-repair-local/);
  assert.match(main, /repair \|\| error\?\.code === 'LOCAL_SERVER_COMPATIBILITY'/);
  const openLocalStart = main.indexOf('async function openLocalInDesktop');
  assert.ok(
    main.indexOf('showLocalStartupTarget', openLocalStart)
      < main.indexOf('const target = await localServer.getResolvedTarget()', openLocalStart),
    'Desktop must render startup/compatibility state before resolving and showing the workspace',
  );
  assert.match(preload, /restartAndRepairLocal/);
});
