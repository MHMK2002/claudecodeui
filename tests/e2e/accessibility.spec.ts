import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { installDesktopLocalMocks } from './fixtures/desktopLocal';
import { installShellSocketMock } from './fixtures/shellSocket';

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((violation) => (
    violation.impact === 'critical' || violation.impact === 'serious'
  ));
  expect(blocking, blocking.map((violation) => (
    `${violation.id}: ${violation.help}\n${violation.nodes.map((node) => `  ${node.target.join(' ')} — ${node.failureSummary}`).join('\n')}`
  )).join('\n\n')).toEqual([]);
}

async function expectVisibleTargetsAtLeast44(page: Page, scope?: Locator) {
  const root = scope ?? page.locator('body');
  const undersized = await root.locator('button, a[href], input, select, textarea, [role="button"], [role="switch"]')
    .evaluateAll((elements) => elements.flatMap((element) => {
      const htmlElement = element as HTMLElement;
      const style = getComputedStyle(htmlElement);
      if (style.display === 'none' || style.visibility === 'hidden' || htmlElement.closest('[aria-hidden="true"]')) return [];
      let rect = htmlElement.getBoundingClientRect();
      if (htmlElement instanceof HTMLInputElement && ['checkbox', 'radio'].includes(htmlElement.type)) {
        rect = htmlElement.closest('label')?.getBoundingClientRect() ?? rect;
      }
      if (rect.width === 0 || rect.height === 0 || (rect.width >= 43.5 && rect.height >= 43.5)) return [];
      return [{
        label: htmlElement.getAttribute('aria-label') || htmlElement.textContent?.trim() || htmlElement.tagName,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }];
    }));
  expect(undersized).toEqual([]);
}

test('Desktop launcher passes axe and touch-target smoke', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/electron/launcher/index.html');
  await expect(page.getByRole('button', { name: 'Open Local Workspace' })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await expectVisibleTargetsAtLeast44(page);
});

test('workspace and Voice Settings pass serious axe, keyboard, focus-return, and target smoke', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: async () => [{
          deviceId: 'a11y-mic',
          groupId: 'a11y-group',
          kind: 'audioinput',
          label: 'Laptop microphone',
          toJSON: () => ({}),
        }],
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
  });
  await installDesktopLocalMocks(page);
  await page.goto('/session/session-1');
  await expectNoSeriousAxeViolations(page);

  const settingsTrigger = page.getByRole('button', { name: 'Settings', exact: true });
  await settingsTrigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await page.getByRole('button', { name: /Advanced voice/ }).click();
  await expect(page.getByRole('region', { name: 'Advanced voice settings' })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await expectVisibleTargetsAtLeast44(page);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(settingsTrigger).toBeFocused();
});

test('required 320px width keeps primary navigation and Voice recoverable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 720 });
  await installDesktopLocalMocks(page);
  await page.goto('/session/session-1');

  await page.getByRole('button', { name: 'Open menu' }).click();
  const settingsTrigger = page.getByRole('button', { name: 'Settings', exact: true });
  await settingsTrigger.click();
  const settingsPicker = page.getByRole('combobox', { name: 'Settings', exact: true });
  await expect(settingsPicker).toBeVisible();
  await settingsPicker.selectOption('voice');
  await expect(page.getByRole('button', { name: 'Test voice input' })).toBeVisible();
  const advancedTrigger = page.getByRole('button', { name: /Advanced voice/ });
  await expect(advancedTrigger).toBeVisible();
  await advancedTrigger.click();
  await expect(page.getByRole('region', { name: 'Advanced voice settings' })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
  await expectVisibleTargetsAtLeast44(page);
});

test('Project, Chat, Shell, Source Control, Tasks, and Schedules pass serious axe smoke', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installDesktopLocalMocks(page, { tasksMode: 'next', updateAvailable: true });
  await installShellSocketMock(page);
  await page.route('**/api/file-tree/projects/project-1/files**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { name: 'src', path: 'src', type: 'directory', children: [] },
      { name: 'README.md', path: 'README.md', type: 'file', size: 128 },
    ]),
  }));
  await page.route('**/api/git/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === '/api/git/status'
      ? {
        branch: 'main',
        detachedHead: false,
        hasCommits: true,
        modified: ['src/app.ts'],
        added: [],
        deleted: [],
        untracked: [],
        staged: ['src/app.ts'],
        conflicts: [],
        operation: null,
      }
      : path === '/api/git/branches'
        ? { branches: ['main'], localBranches: ['main'], remoteBranches: [] }
          : path === '/api/git/remote-status'
          ? {
            hasRemote: true,
            hasUpstream: true,
            branch: 'main',
            remoteName: 'origin',
            remoteBranch: 'origin/main',
            ahead: 0,
            behind: 0,
            isUpToDate: true,
          }
          : path === '/api/git/generate-commit-message'
            ? {
              success: true,
              message: 'feat(git): add accessible suggestions',
              snapshotId: 'a'.repeat(64),
              selection: { provider: 'codex', providerProfileId: 1, model: 'gpt-test' },
              analysis: { totalStagedFiles: 1, sampledFiles: 1, recentSubjects: 4, truncated: false },
            }
          : { success: true };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.route('**/api/scheduled-runs**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ schedules: [] }),
  }));

  await page.goto('/session/session-1');
  await expect(page.getByText('Existing local response')).toBeVisible();
  await test.step('Chat', () => expectNoSeriousAxeViolations(page));

  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByText('README.md', { exact: true })).toBeVisible();
  await test.step('Project Files', () => expectNoSeriousAxeViolations(page));

  await page.getByRole('button', { name: 'Source Control' }).click();
  await expect(page.getByRole('button', { name: /Current branch main/ })).toBeVisible();
  await page.getByRole('button', { name: 'Generate message' }).click();
  await expect(page.getByText('Suggestion ready. Review before committing.')).toBeVisible();
  await expect(page.getByLabel('Commit staged changes')).toBeFocused();
  await test.step('Source Control', () => expectNoSeriousAxeViolations(page));
  await test.step('Source Control targets', () => expectVisibleTargetsAtLeast44(
    page,
    page.getByRole('region', { name: 'Commit composer' }),
  ));

  await page.getByRole('button', { name: 'Shell' }).click();
  await expect(page.getByText('Connected').first()).toBeVisible();
  await expect(page.getByTitle('Local Project')).toBeVisible();
  await test.step('Shell', () => expectNoSeriousAxeViolations(page));

  await page.getByRole('button', { name: 'Tasks' }).click();
  await expect(page.getByRole('button', { name: 'Start task' })).toBeVisible();
  await test.step('Tasks', () => expectNoSeriousAxeViolations(page));

  await page.getByRole('button', { name: 'Open project drawer' }).click();
  const drawer = page.getByRole('complementary', { name: 'Project drawer' });
  await drawer.getByRole('tab', { name: 'Schedules' }).click();
  await expect(drawer.getByRole('button', { name: 'Create your first schedule' })).toBeVisible();
  await test.step('Schedules', () => expectNoSeriousAxeViolations(page));
});
