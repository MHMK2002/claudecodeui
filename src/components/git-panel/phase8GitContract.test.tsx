import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  commitMessageSuggestionReducer,
  createCommitMessageSuggestionState,
  raceWithAbortSignal,
} from './hooks/useCommitMessageSuggestion.js';
import { normalizeGitIssue } from './hooks/useGitPanelController.js';
import GitRecoveryBanner from './view/GitRecoveryBanner.js';
import GitRepositoryErrorState from './view/GitRepositoryErrorState.js';
import FileChangeList from './view/changes/FileChangeList.js';

const noOp = () => undefined;
const recoveryProps = {
  issue: null,
  conflicts: [] as string[],
  undoState: null,
  isContinuingOperation: false,
  isAbortingOperation: false,
  isUndoingFileAction: false,
  onRecover: noOp,
  onResolveConflicts: noOp,
  onContinueOperation: noOp,
  onRequestAbort: noOp,
  onUndo: noOp,
  onDismissIssue: noOp,
};

test('catalog waiting is locally abortable without waiting for the shared request', async () => {
  const controller = new AbortController();
  const sharedRequest = new Promise<string>(() => undefined);
  const localRequest = raceWithAbortSignal(sharedRequest, controller.signal);
  controller.abort();

  await assert.rejects(
    localRequest,
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
});

test('conflict recovery exposes Resolve before the applicable Continue action', () => {
  const unresolved = renderToStaticMarkup(
    <GitRecoveryBanner
      {...recoveryProps}
      operation="merge"
      conflicts={['src/conflicted.ts']}
    />,
  );
  assert.match(unresolved, />Resolve conflicts</);
  assert.match(unresolved, />Abort merge</);
  assert.doesNotMatch(unresolved, />Continue merge</);
  assert.equal((unresolved.match(/\sbg-primary\s/g) ?? []).length, 1);

  const resolved = renderToStaticMarkup(
    <GitRecoveryBanner {...recoveryProps} operation="rebase" />,
  );
  assert.match(resolved, />Continue rebase</);
  assert.match(resolved, /All conflicts are resolved/);
});

test('typed Git failures retain distinct recovery outcomes', () => {
  const authentication = normalizeGitIssue({
    code: 'AUTH_FAILED',
    error: 'Remote authentication failed',
    details: 'Check the configured credential.',
    action: 'OPEN_GIT_SETTINGS',
  }, 'Git operation failed');
  assert.equal(authentication.action, 'OPEN_GIT_SETTINGS');

  const offline = normalizeGitIssue({
    code: 'NETWORK_OFFLINE',
    error: 'Network unavailable',
  }, 'Git operation failed');
  assert.equal(offline.action, 'RETRY');

  const detached = normalizeGitIssue({
    code: 'DETACHED_HEAD',
    error: 'Detached HEAD',
  }, 'Git operation failed');
  assert.equal(detached.action, 'CREATE_BRANCH');
});

test('conflicted files carry a textual conflict status in the change list', () => {
  const markup = renderToStaticMarkup(
    <FileChangeList
      gitStatus={{
        modified: ['src/conflicted.ts'],
        staged: [],
        conflicts: ['src/conflicted.ts'],
      }}
      gitDiff={{}}
      expandedFiles={new Set()}
      selectedFiles={new Set()}
      isMobile={false}
      wrapText
      onToggleSelected={noOp}
      onToggleExpanded={noOp}
      onOpenFile={noOp}
      onToggleWrapText={noOp}
      onRequestFileAction={noOp}
    />,
  );
  assert.match(markup, /aria-label="Conflict"/);
  assert.match(markup, />C</);
  assert.match(markup, /aria-label="Stage src\/conflicted\.ts"/);
});

test('no-repository state owns one exact initialization CTA', () => {
  const markup = renderToStaticMarkup(
    <GitRepositoryErrorState
      error="Not a Git repository"
      canInitRepository
      onInitRepository={noOp}
    />,
  );
  assert.equal((markup.match(/<button/g) ?? []).length, 1);
  assert.match(markup, />\s*Initialize repository\s*</);
  assert.doesNotMatch(markup, /Run git init/);
});

test('transport actions are neutral and branch controls declare full keyboard paths', async () => {
  const [header, branches, changes] = await Promise.all([
    readFile('src/components/git-panel/view/GitPanelHeader.tsx', 'utf8'),
    readFile('src/components/git-panel/view/branches/BranchesView.tsx', 'utf8'),
    readFile('src/components/git-panel/view/changes/ChangesView.tsx', 'utf8'),
  ]);
  assert.doesNotMatch(header, /bg-green-600|bg-orange-600/);
  assert.match(header, /event\.key === 'ArrowDown'/);
  assert.match(header, /event\.key === 'ArrowUp'/);
  assert.match(header, /event\.key === 'Home'/);
  assert.match(header, /event\.key === 'End'/);
  assert.match(header, /branchTriggerRef\.current\?\.focus\(\)/);
  assert.match(branches, /group-focus-within:opacity-100/);
  assert.doesNotMatch(changes, /Create Initial Commit|initial-commit/);
});

const generatedResponse = {
  success: true as const,
  message: 'feat(git): suggest a commit message',
  snapshotId: 'a'.repeat(64),
  selection: {
    provider: 'codex' as const,
    providerProfileId: 12,
    model: 'gpt-test',
  },
  analysis: {
    totalStagedFiles: 1,
    sampledFiles: 1,
    recentSubjects: 4,
    truncated: false,
  },
};

test('suggestion state protects an existing or concurrently edited manual draft', () => {
  const existing = commitMessageSuggestionReducer(
    commitMessageSuggestionReducer(createCommitMessageSuggestionState('manual message'), {
      type: 'request-started',
      requestId: 1,
      projectId: 'project-1',
      stagedKey: 'app.ts',
      mode: 'generate',
    }),
    { type: 'request-succeeded', requestId: 1, projectId: 'project-1', stagedKey: 'app.ts', response: generatedResponse },
  );
  assert.equal(existing.message, 'manual message');
  assert.equal(existing.status, 'suggestion');
  assert.equal(existing.candidate?.message, generatedResponse.message);

  let concurrent = createCommitMessageSuggestionState();
  concurrent = commitMessageSuggestionReducer(concurrent, {
    type: 'request-started',
    requestId: 2,
    projectId: 'project-1',
    stagedKey: 'app.ts',
    mode: 'generate',
  });
  concurrent = commitMessageSuggestionReducer(concurrent, {
    type: 'draft-changed',
    message: 'typed while generating',
  });
  concurrent = commitMessageSuggestionReducer(concurrent, {
    type: 'request-succeeded',
    requestId: 2,
    projectId: 'project-1',
    stagedKey: 'app.ts',
    response: generatedResponse,
  });
  assert.equal(concurrent.message, 'typed while generating');
  assert.equal(concurrent.status, 'suggestion');
});

test('late, cancelled, wrong-project, and wrong-staged-key responses cannot alter the draft', () => {
  let state = commitMessageSuggestionReducer(createCommitMessageSuggestionState(), {
    type: 'request-started',
    requestId: 3,
    projectId: 'project-1',
    stagedKey: 'app.ts',
    mode: 'generate',
  });
  state = commitMessageSuggestionReducer(state, { type: 'request-cancelled', requestId: 3 });

  for (const event of [
    { type: 'request-succeeded' as const, requestId: 3, projectId: 'project-1', stagedKey: 'app.ts', response: generatedResponse },
    { type: 'request-succeeded' as const, requestId: 4, projectId: 'project-1', stagedKey: 'app.ts', response: generatedResponse },
    { type: 'request-succeeded' as const, requestId: 3, projectId: 'project-2', stagedKey: 'app.ts', response: generatedResponse },
    { type: 'request-succeeded' as const, requestId: 3, projectId: 'project-1', stagedKey: 'other.ts', response: generatedResponse },
  ]) {
    state = commitMessageSuggestionReducer(state, event);
  }
  assert.equal(state.status, 'cancelled');
  assert.equal(state.message, '');
  assert.equal(state.snapshotId, null);
});

test('a generated draft becomes stale on staged change and explicit Keep converts it to manual', () => {
  let state = commitMessageSuggestionReducer(createCommitMessageSuggestionState(), {
    type: 'request-started',
    requestId: 5,
    projectId: 'project-1',
    stagedKey: 'app.ts',
    mode: 'generate',
  });
  state = commitMessageSuggestionReducer(state, {
    type: 'request-succeeded',
    requestId: 5,
    projectId: 'project-1',
    stagedKey: 'app.ts',
    response: generatedResponse,
  });
  assert.equal(state.status, 'applied');
  assert.equal(state.snapshotId, generatedResponse.snapshotId);

  state = commitMessageSuggestionReducer(state, { type: 'staged-key-changed', stagedKey: 'app.ts\0view.tsx' });
  assert.equal(state.status, 'stale');
  assert.equal(state.message, generatedResponse.message);

  state = commitMessageSuggestionReducer(state, { type: 'staged-key-changed', stagedKey: 'app.ts' });
  assert.equal(state.status, 'stale');

  state = commitMessageSuggestionReducer(state, { type: 'keep-current-message' });
  assert.equal(state.status, 'manual');
  assert.equal(state.provenance, 'manual');
  assert.equal(state.snapshotId, null);
  assert.equal(state.message, generatedResponse.message);
});

test('generated provenance survives a Git-tab remount and stale invalidation stays sticky', () => {
  let applied = commitMessageSuggestionReducer(createCommitMessageSuggestionState(), {
    type: 'request-started',
    requestId: 6,
    projectId: 'project-1',
    stagedKey: 'app.ts',
    mode: 'generate',
  });
  applied = commitMessageSuggestionReducer(applied, {
    type: 'request-succeeded',
    requestId: 6,
    projectId: 'project-1',
    stagedKey: 'app.ts',
    response: generatedResponse,
  });

  const cacheEntry = (state: typeof applied) => ({
    status: state.status,
    message: state.message,
    draftRevision: state.draftRevision,
    provenance: state.provenance,
    snapshotId: state.snapshotId,
    generatedMessage: state.generatedMessage,
    generatedStagedKey: state.generatedStagedKey,
    selection: state.selection,
    analysis: state.analysis,
  }) as Parameters<typeof createCommitMessageSuggestionState>[0];

  let restored = createCommitMessageSuggestionState(cacheEntry(applied));
  restored = commitMessageSuggestionReducer(restored, {
    type: 'staged-key-changed',
    stagedKey: 'app.ts',
  });
  assert.equal(restored.status, 'applied');

  const stale = commitMessageSuggestionReducer(applied, {
    type: 'staged-key-changed',
    stagedKey: 'app.ts\0view.tsx',
  });
  restored = createCommitMessageSuggestionState(cacheEntry(stale));
  restored = commitMessageSuggestionReducer(restored, {
    type: 'staged-key-changed',
    stagedKey: 'app.ts',
  });
  assert.equal(restored.status, 'stale');
});

test('commit-message generator controls remain neutral and Commit remains the only primary action', async () => {
  const [composer, controller] = await Promise.all([
    readFile('src/components/git-panel/view/changes/CommitComposer.tsx', 'utf8'),
    readFile('src/components/git-panel/hooks/useCommitMessageSuggestion.ts', 'utf8'),
  ]);
  for (const label of [
    'Generate message',
    'Cancel',
    'Use suggestion',
    'Dismiss',
    'Update suggestion',
    'Keep current message',
    'Open Agent Settings',
    'Retry',
  ]) {
    assert.match(composer, new RegExp(label));
  }
  assert.equal((composer.match(/\sbg-primary\s/g) ?? []).length, 1);
  assert.match(controller, /Stage at least one file to generate a message\./);
  assert.match(controller, /Wait for staging to finish\./);
  assert.match(
    composer,
    /onClick=\{suggestion\.updateSuggestion\}[\s\S]*?disabled=\{!suggestion\.canGenerate\}/,
  );
  assert.match(composer, /suggestion\.generateDisabledReason/);
  assert.match(composer, /role="status"|aria-live="polite"/);
  assert.doesNotMatch(composer, /window\.alert|toast/);
});
