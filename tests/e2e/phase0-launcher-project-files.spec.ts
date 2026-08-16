import { expect, test, type Route } from '@playwright/test';

import { installDesktopLocalMocks } from './fixtures/desktopLocal';

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(payload),
});

test('Desktop launcher exposes one local primary path without account or Cloud UI', async ({ page }) => {
  await page.goto('/electron/launcher/index.html');

  const primary = page.locator('.btn.pri');
  await expect(primary).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open Local Workspace' })).toBeVisible();
  await expect(page.getByText(/Connect account|Cloud environments|Hosted|Pro|Premium/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Local Workspace' }).click();
  await expect(page.getByText(/local running · http:\/\/localhost:3001/i)).toBeVisible();
});

test('Create Project separates local and clone configuration before review', async ({ page }) => {
  await installDesktopLocalMocks(page);
  await page.goto('/session/session-1');
  await page.getByTitle('Create new project').click();

  const dialog = page.getByRole('dialog', { name: 'Create project' });
  await expect(dialog).toBeVisible();
  await dialog.getByText('Open existing folder', { exact: true }).click();
  await expect(dialog.getByLabel(/Open existing folder/)).toBeChecked();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('button', { name: /Browse for existing folder/i })).toBeVisible();
  await expect(dialog.getByLabel('Repository URL')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Back' }).click();

  await dialog.getByText('Clone repository', { exact: true }).click();
  await expect(dialog.getByLabel(/Clone repository/)).toBeChecked();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByLabel('Repository URL')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Browse for destination/i })).toBeVisible();
  await expect(dialog.getByText(/credential|token/i)).toHaveCount(0);
});

test('Files distinguishes loaded content from a server recovery state', async ({ page }) => {
  await installDesktopLocalMocks(page);
  let failFiles = false;
  await page.route('**/api/file-tree/projects/project-1/files**', (route) => {
    if (failFiles) {
      return json(route, { error: 'File server unavailable' }, 503);
    }
    return json(route, [
      { name: 'src', path: 'src', type: 'directory', children: [] },
      { name: 'README.md', path: 'README.md', type: 'file', size: 128 },
    ]);
  });

  await page.goto('/session/session-1');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByText('README.md', { exact: true })).toBeVisible();

  failFiles = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('File server unavailable');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});
