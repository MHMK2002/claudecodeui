import { expect, test, type Route } from '@playwright/test';

import { installDesktopLocalMocks } from './fixtures/desktopLocal';

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(payload),
});

const scheduledRun = {
  id: 12,
  userId: 1,
  title: 'Daily local review',
  projectId: 'project-1',
  projectPath: '/workspace/local-project',
  provider: 'codex',
  providerProfileId: 1,
  model: 'gpt-test',
  prompt: 'Review the current project',
  cronExpression: '0 8 * * *',
  timezone: 'UTC',
  notifyOnSuccess: false,
  notifyOnFailure: true,
  notifyChannels: null,
  isEnabled: true,
  lastRunAt: null,
  nextRunAt: '2026-08-17T08:00:00.000Z',
  inFlightRunId: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
};

test('create schedule stays in the main workspace and submits catalog/project identity', async ({ page }) => {
  await installDesktopLocalMocks(page);
  let schedules: typeof scheduledRun[] = [];
  let createPayload: Record<string, unknown> | null = null;
  await page.route('**/api/scheduled-runs**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path !== '/api/scheduled-runs') return json(route, { history: [] });
    if (request.method() === 'POST') {
      createPayload = request.postDataJSON() as Record<string, unknown>;
      schedules = [{ ...scheduledRun, ...createPayload, id: 13 } as typeof scheduledRun];
      return json(route, { schedule: schedules[0] }, 201);
    }
    return json(route, { schedules });
  });

  await page.goto('/session/session-1');
  await page.getByRole('button', { name: 'Open project drawer' }).click();
  const drawer = page.getByRole('complementary', { name: 'Project drawer' });
  await drawer.getByRole('tab', { name: 'Schedules' }).click();
  await drawer.getByRole('button', { name: 'Create your first schedule' }).click();

  await expect(page.getByRole('heading', { name: 'Schedule work for Local Project' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Project path')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Daily' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Weekly' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Custom time' })).toBeVisible();
  await expect(page.getByLabel('Provider', { exact: true })).toHaveValue('codex');
  await expect(page.getByLabel('Profile', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gpt-test');

  const preview = page.getByRole('heading', { name: 'Next three runs' }).locator('xpath=ancestor::section[1]');
  await expect(preview.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByText('Desktop or the local server must be running at execution time.')).toBeVisible();

  await page.getByLabel('Title').fill('Morning review');
  await page.getByLabel('Prompt').fill('Review today’s local changes');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect.poll(() => createPayload?.projectId).toBe('project-1');
  expect(createPayload?.provider).toBe('codex');
  expect(createPayload?.providerProfileId).toBe(1);
  expect(createPayload?.model).toBe('gpt-test');
  expect(createPayload).not.toHaveProperty('projectPath');
  await expect(page.getByRole('heading', { name: 'Schedule work for Local Project' })).toBeHidden();
});

test('Run now is secondary and confirmed Delete remains undoable', async ({ page }) => {
  await installDesktopLocalMocks(page);
  let deleteCalls = 0;
  let runNowCalls = 0;
  await page.route('**/api/scheduled-runs**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/history')) return json(route, { history: [] });
    if (path.endsWith('/run-now')) {
      runNowCalls += 1;
      return json(route, { runId: 91 });
    }
    if (request.method() === 'DELETE') {
      deleteCalls += 1;
      return json(route, { ok: true });
    }
    return json(route, { schedules: [scheduledRun] });
  });

  await page.goto('/session/session-1');
  await page.getByRole('button', { name: 'Open project drawer' }).click();
  const drawer = page.getByRole('complementary', { name: 'Project drawer' });
  await drawer.getByRole('tab', { name: 'Schedules' }).click();
  const card = drawer.getByRole('article').filter({ hasText: scheduledRun.title });
  await card.getByRole('button', { name: 'Schedule actions' }).click();
  await card.getByRole('button', { name: 'Edit' }).click();

  const runNow = page.getByRole('button', { name: 'Run now' });
  await expect(runNow).not.toHaveClass(/bg-primary/);
  await expect(page.getByRole('button', { name: 'Save schedule' })).toHaveClass(/bg-primary/);
  await runNow.click();
  await expect.poll(() => runNowCalls).toBe(1);
  await expect(page.getByText('Run started. Progress will appear in schedule history.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await card.getByRole('button', { name: 'Schedule actions' }).click();
  await card.getByRole('button', { name: 'Delete' }).click();
  await expect(card.getByText(/You can Undo for 8 seconds/)).toBeVisible();
  await card.getByRole('button', { name: 'Delete' }).click();
  await expect(drawer.getByRole('button', { name: 'Undo' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Undo' }).click();
  await expect(drawer.getByText(scheduledRun.title)).toBeVisible();
  expect(deleteCalls).toBe(0);
});

test('an unavailable scheduled provider offers Open Settings', async ({ page }) => {
  await installDesktopLocalMocks(page);
  const unavailable = {
    ...scheduledRun,
    id: 14,
    title: 'Claude review',
    provider: 'claude',
    providerProfileId: 99,
  };
  await page.route('**/api/scheduled-runs**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/history')) return json(route, { history: [] });
    return json(route, { schedules: [unavailable] });
  });

  await page.goto('/session/session-1');
  await page.getByRole('button', { name: 'Open project drawer' }).click();
  const drawer = page.getByRole('complementary', { name: 'Project drawer' });
  await drawer.getByRole('tab', { name: 'Schedules' }).click();
  const card = drawer.getByRole('article').filter({ hasText: unavailable.title });
  await card.getByRole('button', { name: 'Schedule actions' }).click();
  await card.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByText('Claude is not connected.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Settings' })).toBeVisible();
});
