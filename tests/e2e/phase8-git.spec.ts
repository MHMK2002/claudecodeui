import { expect, test, type Page, type Route } from '@playwright/test';

import { installDesktopLocalMocks } from './fixtures/desktopLocal';

type GitMockState = {
  branch: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  staged: string[];
  conflicts: string[];
  operation: 'merge' | 'rebase' | null;
  fetchFailure: boolean;
  generationDelayMs: number;
  generationFailure: boolean;
  generationProviderUnavailable: boolean;
  commitSnapshotConflict: boolean;
};

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(payload),
});

async function installGitMocks(
  page: Page,
  initial: Partial<GitMockState> = {},
) {
  const state: GitMockState = {
    branch: 'main',
    modified: ['src/app.ts'],
    added: [],
    deleted: [],
    untracked: [],
    staged: [],
    conflicts: [],
    operation: null,
    fetchFailure: false,
    generationDelayMs: 0,
    generationFailure: false,
    generationProviderUnavailable: false,
    commitSnapshotConflict: false,
    ...initial,
  };
  const generationRequests: Array<Record<string, unknown>> = [];
  const commitRequests: Array<Record<string, unknown>> = [];

  await page.route('**/api/git/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON?.() as Record<string, unknown> | null;

    if (path === '/api/git/status') {
      await json(route, {
        branch: state.branch,
        detachedHead: false,
        hasCommits: true,
        modified: state.modified,
        added: state.added,
        deleted: state.deleted,
        untracked: state.untracked,
        staged: state.staged,
        conflicts: state.conflicts,
        operation: state.operation,
      });
      return;
    }
    if (path === '/api/git/branches') {
      await json(route, {
        branches: ['main', 'feature', 'release'],
        localBranches: ['main', 'feature', 'release'],
        remoteBranches: [],
      });
      return;
    }
    if (path === '/api/git/remote-status') {
      await json(route, {
        hasRemote: true,
        hasUpstream: true,
        branch: state.branch,
        remoteName: 'origin',
        remoteBranch: `origin/${state.branch}`,
        ahead: 2,
        behind: 1,
        isUpToDate: false,
      });
      return;
    }
    if (path === '/api/git/diff') {
      await json(route, { diff: '@@ -1 +1 @@\n-old\n+new' });
      return;
    }
    if (path === '/api/git/checkout') {
      state.branch = String(body?.branch ?? state.branch);
      await json(route, { success: true });
      return;
    }
    if (path === '/api/git/fetch' && state.fetchFailure) {
      await json(route, {
        success: false,
        code: 'AUTH_FAILED',
        error: 'Remote authentication failed',
        details: 'Check the remote credentials or SSH key in Git settings.',
        action: 'OPEN_GIT_SETTINGS',
      }, 401);
      return;
    }
    if (path === '/api/git/discard') {
      state.modified = state.modified.filter((file) => file !== body?.file);
      await json(route, { success: true, undoToken: 'undo-1' });
      return;
    }
    if (path === '/api/git/delete-untracked') {
      state.untracked = state.untracked.filter((file) => file !== body?.file);
      await json(route, { success: true, undoToken: 'undo-1' });
      return;
    }
    if (path === '/api/git/undo-discard') {
      state.modified = ['src/app.ts'];
      await json(route, { success: true });
      return;
    }
    if (path === '/api/git/continue-operation') {
      state.operation = null;
      await json(route, { success: true });
      return;
    }
    if (path === '/api/git/abort-operation') {
      state.operation = null;
      state.conflicts = [];
      await json(route, { success: true });
      return;
    }
    if (path === '/api/git/stage') {
      const files = Array.isArray(body?.files) ? body.files.map(String) : [];
      state.staged = [...new Set([...state.staged, ...files])];
      await json(route, { success: true });
      return;
    }
    if (path === '/api/git/unstage') {
      const files = new Set(Array.isArray(body?.files) ? body.files.map(String) : []);
      state.staged = state.staged.filter((file) => !files.has(file));
      await json(route, { success: true });
      return;
    }
    if (path === '/api/git/generate-commit-message') {
      generationRequests.push(body ?? {});
      if (state.generationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.generationDelayMs));
      }
      if (state.generationFailure) {
        await json(route, {
          success: false,
          code: 'GENERATION_FAILED',
          error: 'The provider could not generate a message.',
          details: 'Try generating the suggestion again.',
          action: 'RETRY',
        }, 502);
        return;
      }
      if (state.generationProviderUnavailable) {
        await json(route, {
          success: false,
          code: 'PROVIDER_UNAVAILABLE',
          error: 'Codex is unavailable.',
          details: 'Connect Codex in Agent Settings.',
          action: 'OPEN_AGENT_SETTINGS',
        }, 409);
        return;
      }
      await json(route, {
        success: true,
        message: 'feat(git): add reviewed suggestions',
        snapshotId: 'a'.repeat(64),
        selection: {
          provider: 'codex',
          providerProfileId: 1,
          model: 'gpt-test',
          effort: 'low',
        },
        analysis: {
          totalStagedFiles: state.staged.length,
          sampledFiles: state.staged.length,
          recentSubjects: 8,
          truncated: false,
        },
      });
      return;
    }
    if (path === '/api/git/commit') {
      commitRequests.push(body ?? {});
      if (state.commitSnapshotConflict) {
        await json(route, {
          success: false,
          code: 'STAGED_CHANGES_CHANGED',
          error: 'Staged changes changed',
          details: 'Review the latest staged changes before committing.',
          action: 'REVIEW_STAGED_CHANGES',
        }, 409);
        return;
      }
      state.staged = [];
      await json(route, { success: true });
      return;
    }

    await json(route, { success: true });
  });

  return {
    failFetch: () => { state.fetchFailure = true; },
    resolveConflicts: () => { state.conflicts = []; },
    failGeneration: () => { state.generationFailure = true; },
    delayGeneration: (milliseconds: number) => { state.generationDelayMs = milliseconds; },
    conflictNextCommit: () => { state.commitSnapshotConflict = true; },
    generationRequests,
    commitRequests,
  };
}

async function openSourceControl(page: Page) {
  await page.goto('/session/session-1');
  const sourceControl = page.getByRole('button', { name: 'Source Control' });
  await expect(sourceControl).toBeVisible();
  await sourceControl.click();
  await expect(page.getByRole('button', { name: /Current branch main/ })).toBeVisible();
}

test('Changes keeps Commit primary, transport neutral, and branch selection keyboard-complete', async ({ page }) => {
  await installDesktopLocalMocks(page);
  const git = await installGitMocks(page);
  await openSourceControl(page);

  const summary = page.getByRole('region', { name: 'Repository summary' });
  await expect(summary).toContainText('1 changed file');
  await expect(summary).toContainText('1 modified');
  await expect(summary).toContainText('0 staged');
  await expect(summary).toContainText('origin/main');
  await expect(summary).toContainText('Next: review a diff, then stage the files you want to commit.');

  const commit = page.getByRole('button', { name: 'Commit', exact: true });
  await expect(commit).toBeVisible();
  await expect(commit).toHaveClass(/bg-primary/);
  await expect(page.getByText('Stage at least one file to enable Commit.')).toBeVisible();
  await page.getByRole('button', { name: 'Review changes for src/app.ts' }).click();
  await expect(page.getByRole('button', { name: 'Hide changes for src/app.ts' })).toBeVisible();
  await expect(page.getByText('-old', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide changes for src/app.ts' }).click();
  await page.getByRole('button', { name: 'Stage all 1 file' }).click();
  await expect(summary).toContainText('1 staged');
  await expect(page.getByText('Add a commit message to enable Commit.')).toBeVisible();
  await expect(page.getByText('↑2 ahead')).toBeVisible();
  await expect(page.getByText('↓1 behind')).toBeVisible();

  for (const name of ['Fetch', 'Pull 1', 'Push 2']) {
    const action = page.getByRole('button', { name });
    await expect(action).toBeVisible();
    await expect(action).toHaveClass(/border-border/);
    await expect(action).not.toHaveClass(/bg-primary/);
  }

  const branchTrigger = page.getByRole('button', { name: /Current branch main/ });
  await branchTrigger.focus();
  await branchTrigger.press('ArrowDown');
  const search = page.getByRole('combobox', { name: 'Search branches' });
  await expect(search).toBeFocused();
  await search.fill('feature');
  await search.press('Enter');
  await expect(page.getByRole('button', { name: /Current branch feature/ })).toBeVisible();

  const featureTrigger = page.getByRole('button', { name: /Current branch feature/ });
  await featureTrigger.press('ArrowDown');
  await page.getByRole('combobox', { name: 'Search branches' }).press('Escape');
  await expect(featureTrigger).toBeFocused();

  git.failFetch();
  await page.getByRole('button', { name: 'Fetch' }).click();
  const recovery = page.getByRole('alert');
  await expect(recovery).toContainText('Remote authentication failed');
  await expect(recovery.getByRole('button', { name: 'Open Git Settings' })).toBeVisible();
  await expect(commit).not.toBeVisible();
});

test('merge recovery moves from Resolve conflicts to Continue merge and confirms Abort', async ({ page }) => {
  await installDesktopLocalMocks(page);
  const git = await installGitMocks(page, {
    modified: ['src/conflicted.ts'],
    conflicts: ['src/conflicted.ts'],
    operation: 'merge',
  });
  await openSourceControl(page);

  await expect(page.getByRole('button', { name: 'Resolve conflicts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commit', exact: true })).not.toBeVisible();

  git.resolveConflicts();
  await page.getByRole('button', { name: 'Refresh git status' }).click();
  await expect(page.getByRole('button', { name: 'Continue merge' })).toBeVisible();

  await page.getByRole('button', { name: 'Abort merge' }).click();
  const dialog = page.getByRole('dialog', { name: 'Abort Git Operation' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Continue merge' }).click();
  await expect(page.getByRole('button', { name: 'Commit', exact: true })).toBeVisible();
});

test('discard is confirmed and offers scoped Undo only when a token exists', async ({ page }) => {
  await installDesktopLocalMocks(page);
  await installGitMocks(page);
  await openSourceControl(page);

  await page.getByRole('button', { name: 'Discard changes to src/app.ts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard Changes' });
  await expect(dialog).toContainText('Undo will be offered');
  await dialog.getByRole('button', { name: 'Discard' }).click();

  await expect(page.getByText('Changes to src/app.ts were discarded.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Discard changes to src/app.ts' })).toBeVisible();
});

test('generates an editable staged suggestion and commits only with its server snapshot', async ({ page }) => {
  await installDesktopLocalMocks(page);
  const git = await installGitMocks(page, {
    staged: ['src/app.ts'],
    generationDelayMs: 100,
  });
  await openSourceControl(page);

  await page.getByRole('button', { name: 'Generate message' }).click();
  await expect(page.getByRole('status')).toContainText('Generating from 1 staged file');
  const textarea = page.getByLabel('Commit staged changes');
  await expect(textarea).toHaveValue('feat(git): add reviewed suggestions');
  await expect(textarea).toBeFocused();
  await expect(page.getByText('Suggestion ready. Review before committing.')).toBeVisible();

  await page.getByRole('tab', { name: 'Commits', exact: true }).click();
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(textarea).toHaveValue('feat(git): add reviewed suggestions');
  await expect(page.getByText('Staged changes changed after this suggestion was generated.')).toBeHidden();

  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm Action' });
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(textarea).toHaveValue('');

  expect(git.generationRequests).toHaveLength(1);
  expect(git.generationRequests[0]).toEqual({
    project: 'project-1',
    files: ['src/app.ts'],
  });
  expect(git.commitRequests).toHaveLength(1);
  expect(git.commitRequests[0]).toMatchObject({
    project: 'project-1',
    files: ['src/app.ts'],
    expectedSnapshotId: 'a'.repeat(64),
  });
});

test('never overwrites existing input and supports Dismiss then Use suggestion', async ({ page }) => {
  await installDesktopLocalMocks(page);
  await installGitMocks(page, { staged: ['src/app.ts'] });
  await openSourceControl(page);

  const textarea = page.getByLabel('Commit staged changes');
  await textarea.fill('manual draft must survive');
  await page.getByRole('button', { name: 'Generate message' }).click();
  const suggestion = page.getByRole('region', { name: 'Generated commit-message suggestion' });
  await expect(suggestion).toContainText('feat(git): add reviewed suggestions');
  await expect(textarea).toHaveValue('manual draft must survive');
  await suggestion.getByRole('button', { name: 'Dismiss' }).click();
  await expect(suggestion).toBeHidden();
  await expect(textarea).toHaveValue('manual draft must survive');
  await expect(textarea).toBeFocused();

  await page.getByRole('button', { name: 'Generate message' }).click();
  const nextSuggestion = page.getByRole('region', { name: 'Generated commit-message suggestion' });
  await nextSuggestion.getByRole('button', { name: 'Use suggestion' }).click();
  await expect(textarea).toHaveValue('feat(git): add reviewed suggestions');
  await expect(textarea).toBeFocused();
});

test('in-app staged changes make generated provenance stale until explicitly kept as manual', async ({ page }) => {
  await installDesktopLocalMocks(page);
  const git = await installGitMocks(page, {
    modified: ['src/app.ts', 'src/view.tsx'],
    staged: ['src/app.ts', 'src/view.tsx'],
  });
  await openSourceControl(page);

  await page.getByRole('button', { name: 'Generate message' }).click();
  const textarea = page.getByLabel('Commit staged changes');
  await expect(textarea).toHaveValue('feat(git): add reviewed suggestions');
  await page.getByRole('checkbox', { name: 'Unstage src/view.tsx' }).click();

  await expect(page.getByText('Staged changes changed after this suggestion was generated.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commit', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep current message' }).click();
  await expect(page.getByRole('button', { name: 'Commit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm Action' }).getByRole('button', { name: 'Confirm' }).click();
  expect(git.commitRequests[0]).not.toHaveProperty('expectedSnapshotId');
});

test('external same-path index changes return 409, preserve text, and block Commit', async ({ page }) => {
  await installDesktopLocalMocks(page);
  const git = await installGitMocks(page, { staged: ['src/app.ts'] });
  await openSourceControl(page);

  await page.getByRole('button', { name: 'Generate message' }).click();
  const textarea = page.getByLabel('Commit staged changes');
  await expect(textarea).toHaveValue('feat(git): add reviewed suggestions');
  git.conflictNextCommit();
  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm Action' }).getByRole('button', { name: 'Confirm' }).click();

  await expect(textarea).toHaveValue('feat(git): add reviewed suggestions');
  await expect(page.getByText('Staged changes changed after this suggestion was generated.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commit', exact: true })).toBeDisabled();
});

test('Cancel restores the editable state and ignores a delayed success', async ({ page }) => {
  await installDesktopLocalMocks(page);
  await installGitMocks(page, {
    staged: ['src/app.ts'],
    generationDelayMs: 300,
  });
  await openSourceControl(page);

  await page.getByRole('button', { name: 'Generate message' }).click();
  await expect(page.getByText('Generating from 1 staged file…')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Generation cancelled. Your draft was not changed.')).toBeVisible();
  await page.waitForTimeout(450);
  await expect(page.getByLabel('Commit staged changes')).toHaveValue('');
  await expect(page.getByText('Suggestion ready. Review before committing.')).toBeHidden();
});

test('unavailable globally configured provider preserves the manual commit path and opens Agent Settings', async ({ page }) => {
  await installDesktopLocalMocks(page);
  const git = await installGitMocks(page, {
    staged: ['src/app.ts'],
    generationProviderUnavailable: true,
  });
  await openSourceControl(page);

  const textarea = page.getByLabel('Commit staged changes');
  await textarea.fill('manual provider fallback');
  await page.getByRole('button', { name: 'Generate message' }).click();
  await expect(page.getByRole('alert')).toContainText('Codex is unavailable.');
  await expect(textarea).toHaveValue('manual provider fallback');
  await page.getByRole('button', { name: 'Open Agent Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm Action' }).getByRole('button', { name: 'Confirm' }).click();
  expect(git.commitRequests).toHaveLength(1);
  expect(git.commitRequests[0]).not.toHaveProperty('expectedSnapshotId');
});

test('320px mobile keeps active generation visible and manual keyboard Commit operable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await installDesktopLocalMocks(page);
  const git = await installGitMocks(page, { staged: ['src/app.ts'] });
  await openSourceControl(page);

  const collapsed = page.getByRole('button', { name: 'Write or generate commit message · 1 staged' });
  await expect(collapsed).toBeVisible();
  await collapsed.click();
  const textarea = page.getByLabel('Commit staged changes');
  git.delayGeneration(1_000);
  await page.getByRole('button', { name: 'Generate message' }).click();
  await expect(page.getByText('Generating from 1 staged file…')).toBeVisible();
  await page.getByRole('button', { name: 'Review changes for src/app.ts' }).click();
  await expect(page.getByText('Generating from 1 staged file…')).toBeInViewport();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Hide changes for src/app.ts' }).click();

  await textarea.fill('fix: keyboard commit');
  await textarea.press('Control+Enter');
  await expect.poll(() => git.commitRequests.length).toBe(1);
  expect(git.commitRequests[0]).not.toHaveProperty('expectedSnapshotId');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
