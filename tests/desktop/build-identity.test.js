import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('launcher version and service-worker caches are derived from build artifacts', async () => {
  const [launcher, serviceWorker, clientEntry, htmlEntry, serverEntry, prepareScript] = await Promise.all([
    readFile(new URL('../../electron/launcher/launcher.js', import.meta.url), 'utf8'),
    readFile(new URL('../../public/sw.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/main.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../server/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/release/prepare-desktop-app.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(launcher, /__APP_VERSION__\s*=\s*['"]\d/);
  assert.match(launcher, /state\.appVersion/);
  assert.match(serviceWorker, /cloudcli-web-/);
  assert.match(serviceWorker, /searchParams\.get\('build'\)/);
  assert.doesNotMatch(serviceWorker, /filter\(name => name !== CACHE_NAME\)\s*\.map/);
  assert.match(clientEntry, /sw\.js\?build=/);
  assert.doesNotMatch(htmlEntry, /serviceWorker\.register/);
  assert.match(serverEntry, /dist['"], ['"]build-id\.txt/);
  assert.match(serverEntry, /desktopLaunchNonce/);
  assert.ok(
    prepareScript.indexOf('build-server-bundle.js') < prepareScript.indexOf("copyRequired('dist')"),
    'desktop staging must copy web assets after creating the embedded server bundle',
  );
});
