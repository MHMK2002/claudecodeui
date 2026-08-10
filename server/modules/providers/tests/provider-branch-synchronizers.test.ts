import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';

async function withIsolatedDatabase(
  runTest: (directory: string) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'provider-branch-sync-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    await runTest(directory);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(directory, { recursive: true, force: true });
  }
}

function switchBranch(input: {
  appSessionId: string;
  provider: 'claude' | 'codex';
  oldProviderSessionId: string;
  newProviderSessionId: string;
  newJsonlPath: string;
}): void {
  sessionsDb.stageProviderBranch({
    appSessionId: input.appSessionId,
    provider: input.provider,
    expectedProviderSessionId: input.oldProviderSessionId,
    providerSessionId: input.newProviderSessionId,
    jsonlPath: input.newJsonlPath,
    forkPointId: 'retained-point',
  });
  sessionsDb.commitProviderBranchRewind({
    appSessionId: input.appSessionId,
    provider: input.provider,
    expectedProviderSessionId: input.oldProviderSessionId,
    providerSessionId: input.newProviderSessionId,
    jsonlPath: input.newJsonlPath,
    forkPointId: 'retained-point',
  });
}

test('Claude synchronizer suppresses superseded top-level and subagent transcripts', { concurrency: false }, async () => {
  await withIsolatedDatabase(async (directory) => {
    const projectPath = '/workspace/claude-sync-rewind';
    const oldPath = path.join(directory, 'claude-old.jsonl');
    const newPath = path.join(directory, 'claude-new.jsonl');
    await writeFile(oldPath, `${JSON.stringify({
      sessionId: 'claude-old',
      cwd: projectPath,
      uuid: 'old-user',
      message: { role: 'user', content: 'old' },
    })}\n`);
    await writeFile(newPath, `${JSON.stringify({
      sessionId: 'claude-new',
      cwd: projectPath,
      uuid: 'new-user',
      message: { role: 'user', content: 'new' },
    })}\n`);
    sessionsDb.createSession('claude-old', 'claude', projectPath, 'Stable', undefined, undefined, oldPath);
    switchBranch({
      appSessionId: 'claude-old',
      provider: 'claude',
      oldProviderSessionId: 'claude-old',
      newProviderSessionId: 'claude-new',
      newJsonlPath: newPath,
    });

    const synchronizer = new ClaudeSessionSynchronizer();
    assert.equal(await synchronizer.synchronizeFile(oldPath), null);

    const subagentDirectory = path.join(directory, 'subagents');
    await mkdir(subagentDirectory);
    const subagentPath = path.join(subagentDirectory, 'agent-old.jsonl');
    await writeFile(subagentPath, `${JSON.stringify({
      agentId: 'agent-old',
      sessionId: 'claude-old',
      cwd: projectPath,
      message: { role: 'user', content: 'old agent' },
    })}\n`);
    assert.equal(await synchronizer.synchronizeFile(subagentPath), null);
    assert.equal(sessionsDb.getSessionById('agent-old'), null);
    assert.equal(sessionsDb.getAllSessions().length, 1);
  });
});

test('Codex synchronizer suppresses superseded top-level and subagent transcripts', { concurrency: false }, async () => {
  await withIsolatedDatabase(async (directory) => {
    const projectPath = '/workspace/codex-sync-rewind';
    const oldPath = path.join(directory, 'codex-old.jsonl');
    const newPath = path.join(directory, 'codex-new.jsonl');
    await writeFile(oldPath, `${JSON.stringify({
      type: 'session_meta',
      payload: { id: 'codex-old', cwd: projectPath, thread_source: 'user' },
    })}\n`);
    await writeFile(newPath, `${JSON.stringify({
      type: 'session_meta',
      payload: { id: 'codex-new', cwd: projectPath, thread_source: 'user' },
    })}\n`);
    sessionsDb.createSession('codex-old', 'codex', projectPath, 'Stable', undefined, undefined, oldPath);
    switchBranch({
      appSessionId: 'codex-old',
      provider: 'codex',
      oldProviderSessionId: 'codex-old',
      newProviderSessionId: 'codex-new',
      newJsonlPath: newPath,
    });

    const synchronizer = new CodexSessionSynchronizer();
    assert.equal(await synchronizer.synchronizeFile(oldPath), null);

    const subagentPath = path.join(directory, 'codex-agent-old.jsonl');
    await writeFile(subagentPath, `${JSON.stringify({
      type: 'session_meta',
      payload: {
        id: 'codex-agent-old',
        cwd: projectPath,
        parent_thread_id: 'codex-old',
        thread_source: 'subagent',
        source: { subagent: { thread_spawn: {} } },
      },
    })}\n`);
    assert.equal(await synchronizer.synchronizeFile(subagentPath), null);
    assert.equal(sessionsDb.getSessionById('codex-agent-old'), null);
    assert.equal(sessionsDb.getAllSessions().length, 1);
  });
});
