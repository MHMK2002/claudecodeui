import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldShowDesktopFirstRunSetup,
  supportsProviderToken,
} from './desktopFirstRunModel';

test('first-run setup is limited to a ready incomplete internal Desktop principal', () => {
  const eligible = {
    runtimeMode: 'desktop-local' as const,
    user: { username: '__cloudcli_desktop_local__', internal: true },
    hasCompletedOnboarding: false,
    localBootstrapReady: true,
  };
  assert.equal(shouldShowDesktopFirstRunSetup(eligible), true);
  assert.equal(shouldShowDesktopFirstRunSetup({ ...eligible, hasCompletedOnboarding: true }), false);
  assert.equal(shouldShowDesktopFirstRunSetup({
    ...eligible,
    user: { username: 'existing-owner', internal: false },
  }), false);
  assert.equal(shouldShowDesktopFirstRunSetup({ ...eligible, localBootstrapReady: false }), false);
  assert.equal(shouldShowDesktopFirstRunSetup({ ...eligible, runtimeMode: 'desktop-lan' }), false);
});

test('only Claude and Codex offer token setup', () => {
  assert.equal(supportsProviderToken('claude'), true);
  assert.equal(supportsProviderToken('codex'), true);
  assert.equal(supportsProviderToken('cursor'), false);
  assert.equal(supportsProviderToken('opencode'), false);
});
