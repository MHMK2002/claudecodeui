import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-provider-branches-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('branch commit keeps one app chat and absorbs a watcher-created fork row', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/rewind-branch';
    sessionsDb.createAppSession('app-chat', 'claude', projectPath, 17);
    sessionsDb.assignProviderSessionId('app-chat', 'claude-original');
    sessionsDb.createSession(
      'claude-original',
      'claude',
      projectPath,
      'Original title',
      undefined,
      undefined,
      '/transcripts/claude-original.jsonl',
    );
    sessionsDb.createSubagentSession({
      agentSessionId: 'old-agent',
      provider: 'claude',
      parentSessionId: 'app-chat',
      projectPath,
      jsonlPath: '/transcripts/old-agent.jsonl',
    });

    // Simulate the filesystem watcher winning the race before staging.
    sessionsDb.createSession(
      'claude-fork',
      'claude',
      projectPath,
      'Fork duplicate',
      undefined,
      undefined,
      '/transcripts/claude-fork.jsonl',
    );
    assert.equal(sessionsDb.getAllSessions().length, 2);

    sessionsDb.stageProviderBranch({
      appSessionId: 'app-chat',
      provider: 'claude',
      expectedProviderSessionId: 'claude-original',
      providerSessionId: 'claude-fork',
      jsonlPath: '/transcripts/claude-fork.jsonl',
      forkPointId: 'assistant-before-target',
    });
    sessionsDb.commitProviderBranchRewind({
      appSessionId: 'app-chat',
      provider: 'claude',
      expectedProviderSessionId: 'claude-original',
      providerSessionId: 'claude-fork',
      jsonlPath: '/transcripts/claude-fork.jsonl',
      forkPointId: 'assistant-before-target',
    });

    const rows = sessionsDb.getAllSessions();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.session_id, 'app-chat');
    assert.equal(rows[0]?.provider_session_id, 'claude-fork');
    assert.equal(rows[0]?.provider_profile_id, 17);
    assert.equal(rows[0]?.custom_name, 'Original title');
    assert.equal(rows[0]?.project_path, projectPath);
    assert.equal(sessionsDb.getSessionById('old-agent'), null);

    const branches = sessionsDb.listProviderBranches('app-chat');
    assert.deepEqual(
      branches
        .map((branch) => [branch.provider_session_id, branch.state])
        .sort(([left], [right]) => left.localeCompare(right)),
      [
        ['claude-fork', 'current'],
        ['claude-original', 'superseded'],
      ],
    );
    assert.equal(branches.filter((branch) => branch.state === 'current').length, 1);
  });
});

test('branch compare-and-swap rejects a stale rewind without changing the binding', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-chat', 'codex', '/workspace/rewind-cas');
    sessionsDb.assignProviderSessionId('app-chat', 'codex-current');

    assert.throws(() => sessionsDb.stageProviderBranch({
      appSessionId: 'app-chat',
      provider: 'codex',
      expectedProviderSessionId: 'codex-stale',
      providerSessionId: 'codex-fork',
      jsonlPath: '/transcripts/codex-fork.jsonl',
      forkPointId: 'turn-1',
    }), /changed before rewind could be staged/);

    assert.equal(sessionsDb.getSessionById('app-chat')?.provider_session_id, 'codex-current');
    assert.deepEqual(sessionsDb.listProviderBranches('app-chat'), []);
  });
});

test('first-prompt reset clears only the provider binding and adopts the next native session', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/rewind-first-prompt';
    sessionsDb.createAppSession('app-chat', 'codex', projectPath, 4);
    sessionsDb.assignProviderSessionId('app-chat', 'codex-original');
    sessionsDb.createSession(
      'codex-original',
      'codex',
      projectPath,
      'Stable title',
      undefined,
      undefined,
      '/transcripts/codex-original.jsonl',
    );

    sessionsDb.resetProviderBranchForRewind({
      appSessionId: 'app-chat',
      provider: 'codex',
      expectedProviderSessionId: 'codex-original',
      forkPointId: 'turn-1',
    });

    const reset = sessionsDb.getSessionById('app-chat');
    assert.equal(reset?.provider_session_id, null);
    assert.equal(reset?.jsonl_path, null);
    assert.equal(reset?.custom_name, 'Stable title');
    assert.equal(reset?.provider_profile_id, 4);
    assert.equal(sessionsDb.listProviderBranches('app-chat')[0]?.state, 'superseded');

    sessionsDb.assignProviderSessionId('app-chat', 'codex-after-rewind');
    const branches = sessionsDb.listProviderBranches('app-chat');
    assert.equal(branches.filter((branch) => branch.state === 'current').length, 1);
    assert.equal(
      branches.find((branch) => branch.state === 'current')?.provider_session_id,
      'codex-after-rewind',
    );

    assert.throws(() => getConnection().prepare(
      `INSERT INTO session_provider_branches (
         app_session_id, provider, provider_session_id, state
       ) VALUES ('app-chat', 'codex', 'illegal-second-current', 'current')`,
    ).run(), /UNIQUE constraint failed/);
  });
});
