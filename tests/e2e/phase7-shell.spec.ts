import { expect, test } from '@playwright/test';

import { installDesktopLocalMocks } from './fixtures/desktopLocal';
import { installShellSocketMock } from './fixtures/shellSocket';

test('Shell opens a project-id-only interactive terminal and restarts the retained PTY', async ({ page }) => {
  await installDesktopLocalMocks(page);
  await installShellSocketMock(page);
  await page.goto('/session/session-1');

  await page.getByRole('button', { name: 'Shell' }).click();
  await expect(page.getByText('Connected').first()).toBeVisible();
  await expect(page.getByTitle('Local Project')).toBeVisible();

  const firstInit = await page.evaluate(() => {
    const sockets = (window as unknown as {
      __shellSockets: Array<{ url: string; messages: Array<Record<string, unknown>> }>;
    }).__shellSockets;
    const shell = sockets.find((socket) => socket.url.endsWith('/shell'));
    return { url: shell?.url, init: shell?.messages.find((message) => message.type === 'init') };
  });
  expect(new URL(firstInit.url ?? 'http://invalid').search).toBe('');
  expect(firstInit.init).toEqual({
    type: 'init',
    mode: 'interactive-terminal',
    projectId: 'project-1',
    cols: expect.any(Number),
    rows: expect.any(Number),
  });
  expect(firstInit.init).not.toHaveProperty('projectPath');
  expect(firstInit.init).not.toHaveProperty('provider');
  expect(firstInit.init).not.toHaveProperty('sessionId');

  await page.getByRole('button', { name: 'Restart' }).click();
  await expect.poll(async () => page.evaluate(() => {
    const sockets = (window as unknown as {
      __shellSockets: Array<{ url: string; messages: Array<Record<string, unknown>> }>;
    }).__shellSockets;
    return sockets.filter((socket) => socket.url.endsWith('/shell')).length;
  })).toBeGreaterThan(1);
  await expect(page.getByText('Connected').first()).toBeVisible();
  const restartInit = await page.evaluate(() => {
    const sockets = (window as unknown as {
      __shellSockets: Array<{ url: string; messages: Array<Record<string, unknown>> }>;
    }).__shellSockets.filter((socket) => socket.url.endsWith('/shell'));
    return sockets.at(-1)?.messages.find((message) => message.type === 'init');
  });
  expect(restartInit).toMatchObject({
    mode: 'interactive-terminal',
    projectId: 'project-1',
    forceRestart: true,
  });
});

test('Shell renders contextual cwd recovery instead of an empty terminal', async ({ page }) => {
  await installDesktopLocalMocks(page);
  await installShellSocketMock(page, 'CWD_UNAVAILABLE');
  await page.goto('/session/session-1');
  await page.getByRole('button', { name: 'Shell' }).click();

  const recovery = page.getByRole('alert');
  await expect(recovery).toContainText('registered project folder is unavailable');
  await expect(recovery.getByRole('button', { name: 'Retry folder' })).toBeVisible();
});
