import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { buildSessionUpsertedEvent } from '@/modules/providers/services/sessions-watcher.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-watcher-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('subagent file changes upsert the parent instead of creating a top-level session event', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/watcher-subagent';
    sessionsDb.createSession('parent-session', 'codex', projectPath, 'Parent Session');
    projectsDb.updateCustomProjectName(projectPath, 'Watcher Project');
    sessionsDb.createSubagentSession({
      agentSessionId: 'agent-session',
      provider: 'codex',
      parentSessionId: 'parent-session',
      projectPath,
      jsonlPath: '/transcripts/agent-session.jsonl',
      agentType: 'dispatch',
      customName: 'Noether',
    });

    const serialized = await buildSessionUpsertedEvent('agent-session');
    assert.ok(serialized);

    const event = JSON.parse(serialized) as {
      sessionId?: string;
      session?: { id?: string; agentCount?: number };
    };
    assert.equal(event.sessionId, 'parent-session');
    assert.equal(event.session?.id, 'parent-session');
    assert.equal(event.session?.agentCount, 1);
  });
});
