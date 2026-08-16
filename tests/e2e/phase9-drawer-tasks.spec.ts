import { expect, test, type Page, type Route } from '@playwright/test';

import { installDesktopLocalMocks } from './fixtures/desktopLocal';

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(payload),
});

test('project drawer is docked, resizable, and restores open tab state', async ({ page }) => {
  await installDesktopLocalMocks(page, { tasksMode: 'empty' });
  await page.goto('/session/session-1');

  await page.getByRole('button', { name: 'Open project drawer' }).click();
  const drawer = page.getByRole('complementary', { name: 'Project drawer' });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('[class*="backdrop-blur"]')).toHaveCount(0);
  const initialWidth = (await drawer.boundingBox())?.width ?? 0;
  await page.getByRole('separator', { name: 'Resize project drawer' }).press('ArrowLeft');
  await expect.poll(async () => (await drawer.boundingBox())?.width ?? 0).toBeGreaterThan(initialWidth);

  await drawer.getByRole('tab', { name: 'Schedules' }).click();
  await expect(drawer.getByRole('tab', { name: 'Schedules' })).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Project drawer' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Project drawer' }).getByRole('tab', { name: 'Schedules' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Close project drawer' }).click();
  await expect(page.getByRole('complementary', { name: 'Project drawer' })).toBeHidden();
});

test('drawer setup action opens Analyze → Preview → Confirm in the main workspace', async ({ page }) => {
  await installDesktopLocalMocks(page, { tasksMode: 'empty' });
  await page.route('**/api/taskmaster/init/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/analyze')) {
      await json(route, {
        success: true,
        data: {
          plan: {
            attemptId: 'setup-1',
            before: { status: 'missing', missing: ['.taskmaster/config.json'], invalid: [] },
            operations: [{
              path: '.taskmaster/config.json',
              action: 'create',
              description: 'Create .taskmaster/config.json',
              source: 'reference',
            }],
            modelDefaults: { main: 'generated-default' },
            changesExistingModelDefaults: false,
            repair: false,
          },
        },
      });
      return;
    }
    if (path.endsWith('/apply')) {
      const lines = [
        { type: 'progress', progress: { stage: 'backup', message: 'Backing up existing files', completed: 0, total: 6 } },
        { type: 'progress', progress: { stage: 'validate', message: 'Validating TaskMaster setup', completed: 4, total: 6 } },
        { type: 'result', success: true, data: {
          after: { status: 'valid', missing: [], invalid: [] },
          added: ['.taskmaster/config.json'],
          replaced: [],
          merged: [],
          rollbackPerformed: false,
        } },
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
      });
      return;
    }
    await json(route, { success: true }, 202);
  });

  await page.goto('/session/session-1');
  await page.getByRole('button', { name: 'Open project drawer' }).click();
  await page.getByRole('complementary', { name: 'Project drawer' }).getByRole('button', { name: 'Set up Tasks' }).click();

  await expect(page.getByRole('heading', { name: 'Set up Tasks for Local Project' })).toBeVisible();
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByRole('heading', { name: 'Preview changes' })).toBeVisible();
  await expect(page.getByText('Existing model defaults will not change.')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm changes' }).click();
  await expect(page.getByRole('heading', { name: 'Tasks are ready' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Tasks' })).toBeVisible();
});

test('Start task exposes truthful progress, Cancel, and a retryable recovery', async ({ page }) => {
  await installDesktopLocalMocks(page, { tasksMode: 'next' });
  let beginCount = 0;
  let linkOnRetry = false;

  await page.route('**/api/providers/sessions', async (route) => {
    await json(route, { success: true, data: { sessionId: 'task-session-1' } }, 201);
  });
  await page.route('**/api/taskmaster/workflow/project-1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/tasks/task-1/launch')) {
      beginCount += 1;
      await json(route, {
        success: true,
        data: { attempt: {
          id: 'attempt-1',
          taskId: 'task-1',
          sessionId: beginCount > 1 ? 'task-session-1' : null,
          status: beginCount > 1 ? 'bound' : 'reserved',
          content: 'Implement task 1',
          contentHash: 'hash-1',
        } },
      });
      return;
    }
    if (path.endsWith('/launches/attempt-1/bind')) {
      await json(route, {
        success: true,
        data: { attempt: {
          id: 'attempt-1', taskId: 'task-1', sessionId: 'task-session-1', status: 'bound',
          content: 'Implement task 1', contentHash: 'hash-1',
        } },
      });
      return;
    }
    if (path.endsWith('/launches/attempt-1')) {
      if (!linkOnRetry) await new Promise((resolve) => setTimeout(resolve, 2000));
      await json(route, {
        success: true,
        data: { attempt: {
          id: 'attempt-1', taskId: 'task-1', sessionId: 'task-session-1',
          status: linkOnRetry ? 'linked' : 'bound', content: 'Implement task 1', contentHash: 'hash-1',
        } },
      });
      return;
    }
    await json(route, { success: true, data: {} });
  });

  await page.goto('/session/session-1');
  await page.getByRole('button', { name: 'Tasks' }).click();
  await page.getByRole('button', { name: 'Start task' }).click();
  await expect(page.getByText(/Starting task · (session|bind|dispatch|delivery)/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alert')).toContainText('cancelled');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

  linkOnRetry = true;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => beginCount).toBe(2);
  await expect(page.getByRole('alert')).not.toBeVisible();
});
