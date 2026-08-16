import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { installDesktopLocalMocks } from './fixtures/desktopLocal';

type DesktopUpdaterHarness = {
  installCalls: number;
  emitReady(): void;
};

test('desktop update downloads in place and installs only after explicit restart', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    let state: DesktopUpdaterState = {
      enabled: true,
      phase: 'downloading',
      currentVersion: '1.37.0',
      buildId: '1.37.0-test',
      checkedAt: '2026-08-16T00:00:00.000Z',
      release: {
        version: '1.38.0',
        title: 'CloudCLI 1.38.0',
        notes: 'A signed desktop update with automatic download.',
        publishedAt: '2026-08-16T00:00:00.000Z',
        releaseUrl: 'https://github.com/MHMK2002/claudecodeui/releases',
      },
      progress: {
        percent: 42.4,
        transferred: 4_240_000,
        total: 10_000_000,
        bytesPerSecond: 512_000,
      },
      error: null,
      disabledReason: null,
    };
    let listener: ((nextState: DesktopUpdaterState) => void) | null = null;
    const harness: DesktopUpdaterHarness = {
      installCalls: 0,
      emitReady() {
        state = { ...state, phase: 'ready', progress: { ...state.progress!, percent: 100 } };
        listener?.(state);
      },
    };
    Object.defineProperty(window, '__desktopUpdaterHarness', { value: harness });
    window.cloudcliDesktopUpdater = {
      getState: async () => state,
      check: async () => state,
      restartAndInstall: async () => {
        harness.installCalls += 1;
        state = { ...state, phase: 'installing' };
        listener?.(state);
        return state;
      },
      onStateChanged: (callback) => {
        listener = callback;
        return () => {
          listener = null;
        };
      },
    };
  });
  await installDesktopLocalMocks(page);

  const updateFeedRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/releases/latest')) updateFeedRequests.push(request.url());
  });
  await page.goto('/session/session-1');

  const updateTrigger = page.getByRole('button').filter({ hasText: '42% downloaded' });
  await expect(updateTrigger).toBeVisible();
  await updateTrigger.click();

  const dialog = page.getByRole('dialog', { name: 'Desktop update' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('progressbar', { name: 'Update download progress' })).toHaveAttribute('aria-valuenow', '42');
  await expect(dialog.getByText('Downloading update — 42%')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Restart and update' })).toHaveCount(0);
  const axeResults = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axeResults.violations.filter((violation) => (
    violation.impact === 'critical' || violation.impact === 'serious'
  ))).toEqual([]);

  await page.evaluate(() => {
    (window as Window & { __desktopUpdaterHarness: DesktopUpdaterHarness }).__desktopUpdaterHarness.emitReady();
  });
  await expect(dialog.getByText('Ready to install')).toBeVisible();
  await dialog.getByRole('button', { name: 'Restart and update' }).click();
  await expect(dialog.getByText('Restarting to install…')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __desktopUpdaterHarness: DesktopUpdaterHarness }
  ).__desktopUpdaterHarness.installCalls)).toBe(1);
  expect(updateFeedRequests).toEqual([]);
});
