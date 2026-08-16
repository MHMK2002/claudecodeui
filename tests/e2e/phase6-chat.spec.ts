import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { installDesktopLocalMocks } from './fixtures/desktopLocal';

const openExistingChat = async (page: import('@playwright/test').Page) => {
  await page.goto('/session/session-1');
  await expect(page.locator('.chat-composer-shell textarea')).toBeVisible();
};

const selectZipExport = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Export chat' }).click();
  const menu = page.getByRole('menu', { name: 'Export chat' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem').filter({ hasText: 'ZIP' }).click();
};

test('one header Export menu exposes four keyboard-operable formats', async ({ page }) => {
  await installDesktopLocalMocks(page);
  await openExistingChat(page);

  const trigger = page.getByRole('button', { name: 'Export chat' });
  await expect(trigger).toHaveCount(1);
  await trigger.focus();
  await page.keyboard.press('ArrowDown');

  const menu = page.getByRole('menu', { name: 'Export chat' });
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toContainText('Markdown');
  await expect(items.nth(1)).toContainText('HTML');
  await expect(items.nth(2)).toContainText('PDF');
  await expect(items.nth(3)).toContainText('ZIP');
  await expect(items.nth(0)).toBeFocused();

  await page.keyboard.press('End');
  await expect(items.nth(3)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  await expect(trigger).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});

test('HTML catalog failure has one recovery pair and preserves the draft through Retry', async ({ page }) => {
  const mocks = await installDesktopLocalMocks(page, { catalogMode: 'html' });
  await openExistingChat(page);

  const draft = page.locator('.chat-composer-shell textarea');
  await draft.fill('Draft survives catalog recovery');
  const recovery = page.getByRole('alert').filter({ hasText: 'Providers could not be loaded.' });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole('button', { name: 'Retry' })).toHaveCount(1);
  const openAgentSettings = recovery.getByRole('button', { name: 'Open Agent Settings' });
  await expect(openAgentSettings).toHaveCount(1);
  await expect(page.getByText(/Unexpected token/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);

  await openAgentSettings.click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agents' }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden();

  mocks.useJsonCatalog();
  await recovery.getByRole('button', { name: 'Retry' }).click();
  await expect(recovery).toBeHidden();
  await expect(draft).toHaveValue('Draft survives catalog recovery');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('catalog and initial history failures expose exactly one page-level primary recovery', async ({ page }) => {
  await installDesktopLocalMocks(page, { catalogMode: 'html', historyMode: 'error' });
  await openExistingChat(page);

  const catalogRecovery = page.getByRole('alert').filter({ hasText: 'Providers could not be loaded.' });
  const historyRecovery = page.getByRole('alert').filter({ hasText: 'Conversation history could not be loaded.' });
  await expect(catalogRecovery).toBeVisible();
  await expect(historyRecovery).toBeVisible();
  await expect(page.locator('.chat-messages-pane [data-ux-primary="true"], .chat-composer-shell [data-ux-primary="true"]')).toHaveCount(1);
  await expect(catalogRecovery.getByRole('button', { name: 'Retry' })).toHaveAttribute('data-ux-primary', 'true');
  await expect(historyRecovery.getByRole('button', { name: 'Retry history' })).not.toHaveAttribute('data-ux-primary', 'true');
  await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);
});

test('a malformed successful history envelope renders recovery instead of empty success', async ({ page }) => {
  await installDesktopLocalMocks(page, { historyMode: 'malformed' });
  await openExistingChat(page);

  const recovery = page.getByRole('alert').filter({ hasText: 'Conversation history could not be loaded.' });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole('button', { name: 'Retry history' })).toBeVisible();
  await expect(page.getByText('Existing local response')).toHaveCount(0);
});

test('empty Chat keeps its next-task affordance neutral beside the sole primary Send', async ({ page }) => {
  await installDesktopLocalMocks(page, { historyMode: 'empty', tasksMode: 'next' });
  const taskStateReady = Promise.all([
    '/api/taskmaster/installation-status',
    '/api/projects/project-1/taskmaster',
    '/api/taskmaster/tasks/project-1',
  ].map((expectedPath) => page.waitForResponse((response) => (
    new URL(response.url()).pathname === expectedPath && response.ok()
  ))));
  await openExistingChat(page);
  await taskStateReady;

  const startTask = page.getByRole('button', { name: 'Start Task' });
  await expect(startTask).toBeVisible();
  await expect(startTask).not.toHaveClass(/bg-blue-600/);
  await expect(page.getByRole('button', { name: 'Send' })).toHaveAttribute('data-ux-primary', 'true');
  await expect(page.locator('.chat-messages-pane [data-ux-primary="true"], .chat-composer-shell [data-ux-primary="true"]')).toHaveCount(1);
});

test('long session history loading reveals a delayed message skeleton', async ({ page }) => {
  await installDesktopLocalMocks(page, { historyDelayMs: 900 });
  await page.goto('/session/session-1');

  await expect(page.getByTestId('session-message-skeleton')).toBeVisible();
  await expect(page.getByText('Existing local response')).toBeVisible();
  await expect(page.getByTestId('session-message-skeleton')).toBeHidden();
});

test('Send becomes exactly one Stop while running, keeps Queue secondary, then returns to Send', async ({ page }) => {
  await installDesktopLocalMocks(page);
  await openExistingChat(page);
  await expect(page.getByText('Existing local response')).toBeVisible();

  const draft = page.locator('.chat-composer-shell textarea');
  await draft.fill('Start the run');
  await page.getByRole('button', { name: 'Send' }).click();
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toHaveCount(1);
  await expect(stop).toBeEnabled();

  await draft.fill('Queue this later');
  await expect(page.getByRole('button', { name: 'Queue next message' })).toBeVisible();
  await expect(stop).toHaveCount(1);
  await stop.click();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
});

test('AskUserQuestion keeps exactly one accessible Stop control while the run is active', async ({ page }) => {
  await installDesktopLocalMocks(page);
  await openExistingChat(page);

  const draft = page.locator('.chat-composer-shell textarea');
  await draft.fill('[ask-user] Choose a path');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Which path should continue?')).toBeVisible();
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toHaveCount(1);
  await expect(stop).toBeVisible();
  await expect(stop).toHaveAttribute('data-ux-primary', 'true');
  await stop.click();
});

for (const scenario of [
  { trigger: '[generic-permission]', activeText: 'Permission required', waiting: 0 },
  { trigger: '[multi-permission]', activeText: 'Permission required', waiting: 1 },
  { trigger: '[mixed-permission]', activeText: 'Which path should continue?', waiting: 1 },
]) {
  test(`${scenario.trigger} serializes permission recovery behind the sole primary Stop`, async ({ page }) => {
    await installDesktopLocalMocks(page);
    await openExistingChat(page);

    const draft = page.locator('.chat-composer-shell textarea');
    await draft.fill(`${scenario.trigger} verify one primary`);
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText(scenario.activeText).first()).toBeVisible();
    const stop = page.getByRole('button', { name: 'Stop' });
    await expect(stop).toHaveCount(1);
    await expect(stop).toHaveAttribute('data-ux-primary', 'true');
    await expect(page.locator('.chat-messages-pane [data-ux-primary="true"], .chat-composer-shell [data-ux-primary="true"]')).toHaveCount(1);

    if (scenario.waiting > 0) {
      await expect(page.getByText(`${scenario.waiting} more permission request is waiting.`)).toBeVisible();
    } else {
      await expect(page.getByText(/more permission .* waiting/)).toHaveCount(0);
    }

    const allowOnce = page.getByRole('button', { name: 'Allow once' });
    if (scenario.activeText === 'Permission required') {
      await expect(allowOnce).toHaveCount(1);
      await expect(allowOnce).not.toHaveClass(/bg-primary/);
    } else {
      await expect(allowOnce).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Submit' })).not.toHaveClass(/from-blue/);
    }
    await stop.click();
  });
}

test('disconnected AskUserQuestion preserves its selection and makes Retry connection primary', async ({ page }) => {
  await installDesktopLocalMocks(page);
  await openExistingChat(page);

  const draft = page.locator('.chat-composer-shell textarea');
  await draft.fill('[ask-user] preserve this answer');
  await page.getByRole('button', { name: 'Send' }).click();
  const localOption = page.getByRole('radiogroup').getByRole('button').filter({ hasText: 'Local' });
  await localOption.click();
  await expect(localOption).toHaveClass(/border-blue-300/);

  const response = await page.request.post('/__e2e__/disconnect');
  expect(response.status()).toBe(204);
  const recovery = page.getByRole('alert').filter({ hasText: 'Chat connection unavailable.' });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole('button', { name: 'Retry connection' })).toHaveAttribute('data-ux-primary', 'true');
  await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeDisabled();
  await expect(localOption).toHaveClass(/border-blue-300/);
  await expect(page.locator('.chat-messages-pane [data-ux-primary="true"], .chat-composer-shell [data-ux-primary="true"]')).toHaveCount(1);

  await recovery.getByRole('button', { name: 'Retry connection' }).click();
  await expect(recovery).toBeHidden();
  await expect(page.getByText('Which path should continue?')).toBeVisible();
  await expect(localOption).toHaveClass(/border-blue-300/);
  await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Which path should continue?')).toBeHidden();
});

test('a dropped Chat socket preserves the draft and offers immediate reconnection', async ({ page }) => {
  await installDesktopLocalMocks(page);
  await openExistingChat(page);

  const draft = page.locator('.chat-composer-shell textarea');
  await draft.fill('Start a disconnectable run');
  await page.getByRole('button', { name: 'Send' }).click();
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeEnabled();

  await draft.fill('Preserve this queued draft');
  const response = await page.request.post('/__e2e__/disconnect');
  expect(response.status()).toBe(204);

  const recovery = page.getByRole('alert').filter({ hasText: 'Chat connection unavailable.' });
  await expect(recovery).toBeVisible();
  await expect(draft).toHaveValue('Preserve this queued draft');
  await expect(stop).toBeVisible();
  await expect(stop).toBeDisabled();

  await recovery.getByRole('button', { name: 'Retry connection' }).click();
  await expect(recovery).toBeHidden();
  await expect(draft).toHaveValue('Preserve this queued draft');
});

test('ZIP export downloads a validated archive', async ({ page }) => {
  await installDesktopLocalMocks(page, { zipMode: 'valid' });
  await openExistingChat(page);

  const downloadPromise = page.waitForEvent('download');
  await selectZipExport(page);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('local-session.zip');
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  await expect(page.getByRole('status').filter({ hasText: 'ZIP export downloaded.' })).toBeVisible();
});

for (const scenario of [
  { mode: 'html' as const, message: 'unexpected content type' },
  { mode: 'empty' as const, message: 'empty archive' },
  { mode: 'invalid' as const, message: 'unreadable or corrupt archive' },
  { mode: 'truncated' as const, message: 'unreadable or corrupt archive' },
]) {
  test(`ZIP ${scenario.mode} response stays inline as a failure`, async ({ page }) => {
    await installDesktopLocalMocks(page, { zipMode: scenario.mode });
    await openExistingChat(page);

    await selectZipExport(page);
    const failure = page.getByRole('alert').filter({ hasText: scenario.message });
    await expect(failure).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'ZIP export downloaded.' })).toHaveCount(0);
    await expect(failure.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
}

test('320px Chat keeps the document contained and title actions recoverable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await installDesktopLocalMocks(page);
  await openExistingChat(page);

  const title = page.locator('h2[title]').first();
  await expect(title).toHaveAttribute('title', /deliberately long local session title/);
  await expect(page.getByRole('button', { name: 'Export chat' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport);
});
