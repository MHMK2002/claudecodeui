import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
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

test('session archive queries hide archived rows from active project views', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-active', 'claude', '/workspace/demo-project', 'Active Session');
    sessionsDb.createSession('session-archived', 'claude', '/workspace/demo-project', 'Archived Session');
    sessionsDb.updateSessionIsArchived('session-archived', true);

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const activeProjectSessions = sessionsDb.getSessionsByProjectPath('/workspace/demo-project');
    const allProjectSessions = sessionsDb.getSessionsByProjectPathIncludingArchived('/workspace/demo-project');

    assert.deepEqual(activeSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(archivedSessions.map((session) => session.session_id), ['session-archived']);
    assert.deepEqual(activeProjectSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(
      allProjectSessions.map((session) => session.session_id).sort(),
      ['session-active', 'session-archived'],
    );
    assert.equal(sessionsDb.countSessionsByProjectPath('/workspace/demo-project'), 1);
  });
});

test('createSession reactivates archived rows when the session becomes active again', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'First Name');
    sessionsDb.updateSessionIsArchived('session-reused', true);

    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'Updated Name');

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const restoredSession = sessionsDb.getSessionById('session-reused');

    assert.equal(activeSessions.length, 1);
    assert.equal(activeSessions[0]?.session_id, 'session-reused');
    assert.equal(activeSessions[0]?.custom_name, 'Updated Name');
    assert.equal(archivedSessions.length, 0);
    assert.equal(restoredSession?.isArchived, 0);
  });
});

test('provider synchronizers cannot expose isolated commit-message sessions', async () => {
  await withIsolatedDatabase(() => {
    const hiddenProjectPath = path.join(tmpdir(), 'cloudcli-commit-message-hidden-test');
    const similarlyNamedProjectPath = path.join(
      path.parse(tmpdir()).root,
      'workspace',
      'cloudcli-commit-message-real-project',
    );

    sessionsDb.createSession(
      'hidden-native-session',
      'codex',
      hiddenProjectPath,
      'Generated commit message',
    );

    assert.equal(sessionsDb.getSessionById('hidden-native-session'), null);
    assert.deepEqual(sessionsDb.getAllSessions(), []);

    sessionsDb.createSession(
      'visible-native-session',
      'codex',
      similarlyNamedProjectPath,
      'Real project session',
    );

    assert.equal(
      sessionsDb.getSessionById('visible-native-session')?.project_path,
      similarlyNamedProjectPath,
    );
  });
});

test('sub-agent rows stay out of every session listing but remain addressable', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/demo-project';
    sessionsDb.createSession('parent-session', 'claude', projectPath, 'Parent Session');
    sessionsDb.createSubagentSession({
      agentSessionId: 'agent-1',
      provider: 'claude',
      parentSessionId: 'parent-session',
      projectPath,
      jsonlPath: '/transcripts/agent-1.jsonl',
      agentType: 'general-purpose',
      customName: 'Coverage analysis',
    });
    sessionsDb.createSubagentSession({
      agentSessionId: 'agent-2',
      provider: 'claude',
      parentSessionId: 'parent-session',
      projectPath,
      jsonlPath: '/transcripts/agent-2.jsonl',
    });

    // Every listing query must show the parent alone — a leak here would put
    // agents in the sidebar, search, and archive views as if they were real
    // sessions.
    const onlyParent = ['parent-session'];
    assert.deepEqual(sessionsDb.getAllSessions().map((row) => row.session_id), onlyParent);
    assert.deepEqual(sessionsDb.getSessionsByProjectPath(projectPath).map((row) => row.session_id), onlyParent);
    assert.deepEqual(
      sessionsDb.getSessionsByProjectPathPage(projectPath, 20, 0).map((row) => row.session_id),
      onlyParent,
    );
    assert.deepEqual(
      sessionsDb.getSessionsUpdatedSince('1970-01-01T00:00:00.000Z').map((row) => row.session_id),
      onlyParent,
    );
    assert.equal(sessionsDb.countSessionsByProjectPath(projectPath), 1);

    sessionsDb.updateSessionIsArchived('parent-session', true);
    assert.deepEqual(sessionsDb.getArchivedSessions().map((row) => row.session_id), onlyParent);
    sessionsDb.updateSessionIsArchived('parent-session', false);

    // Deletion cleanup is the one reader that keeps children, so their
    // transcript files are not orphaned.
    assert.deepEqual(
      sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath).map((row) => row.session_id).sort(),
      ['agent-1', 'agent-2', 'parent-session'],
    );

    // Lookups by id stay unfiltered so an agent transcript can be opened.
    const agent = sessionsDb.getSessionById('agent-1');
    assert.equal(agent?.parent_session_id, 'parent-session');
    assert.equal(agent?.agent_type, 'general-purpose');
    assert.equal(agent?.jsonl_path, '/transcripts/agent-1.jsonl');

    assert.deepEqual(
      sessionsDb.getSubagentsByParentSessionId('parent-session').map((row) => row.session_id),
      ['agent-1', 'agent-2'],
    );
    assert.equal(sessionsDb.countSubagentsByParentSessionIds(['parent-session']).get('parent-session'), 2);
  });
});

test('deleting a session removes the sub-agents it spawned', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('parent-session', 'claude', '/workspace/demo-project', 'Parent Session');
    sessionsDb.createSubagentSession({
      agentSessionId: 'agent-1',
      provider: 'claude',
      parentSessionId: 'parent-session',
      projectPath: '/workspace/demo-project',
      jsonlPath: '/transcripts/agent-1.jsonl',
    });

    assert.equal(sessionsDb.deleteSessionById('parent-session'), true);
    assert.equal(sessionsDb.getSessionById('agent-1'), null);
  });
});

test('repository reads normalize SQLite UTC timestamps to ISO strings', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-timezone', 'claude', '/workspace/demo-project');

    const row = sessionsDb.getSessionById('session-timezone');
    assert.ok(row?.created_at.endsWith('Z'));
    assert.ok(row?.updated_at.endsWith('Z'));
    assert.match(row?.created_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.match(row?.updated_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('provider profile binding is atomic and never overwrites an established session binding', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('external-session', 'claude', '/workspace/demo-project');

    assert.equal(
      sessionsDb.bindProviderProfileIfUnassigned('external-session', 'claude', 41),
      41,
    );
    assert.equal(
      sessionsDb.bindProviderProfileIfUnassigned('external-session', 'claude', 99),
      41,
    );
    assert.equal(
      sessionsDb.bindProviderProfileIfUnassigned('external-session', 'codex', 72),
      null,
    );
    assert.equal(sessionsDb.getSessionById('external-session')?.provider_profile_id, 41);
    assert.equal(
      sessionsDb.getSessionById('external-session')?.provider_session_id,
      'external-session',
    );
  });
});
