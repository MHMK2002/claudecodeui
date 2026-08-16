import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRuntimeMode,
  resolveRuntimeMode,
  usesPasswordlessDesktopSession,
  validateRuntimeModeHost,
} from '../../shared/runtime-mode.js';

test('runtime mode resolution is explicit and standalone web is the only unmanaged default', () => {
  assert.equal(resolveRuntimeMode(), 'standalone-web');
  assert.equal(resolveRuntimeMode({ isPlatform: true }), 'platform');
  assert.equal(resolveRuntimeMode({
    configuredMode: 'desktop-local',
    desktopManaged: true,
  }), 'desktop-local');
  assert.throws(
    () => resolveRuntimeMode({ configuredMode: 'desktop-local' }),
    /app-managed Desktop process/i,
  );
  assert.throws(() => assertRuntimeMode('local'), /must be one of/i);
});

test('desktop-local and desktop-lan enforce opposite network bind boundaries', () => {
  assert.equal(validateRuntimeModeHost('desktop-local', '127.0.0.1'), '127.0.0.1');
  assert.equal(validateRuntimeModeHost('desktop-lan', '0.0.0.0'), '0.0.0.0');
  assert.throws(
    () => validateRuntimeModeHost('desktop-local', '0.0.0.0'),
    /must bind to a loopback/i,
  );
  assert.throws(
    () => validateRuntimeModeHost('desktop-lan', 'localhost'),
    /non-loopback bind/i,
  );
  assert.equal(usesPasswordlessDesktopSession('desktop-local'), true);
  assert.equal(usesPasswordlessDesktopSession('desktop-lan'), false);
});
