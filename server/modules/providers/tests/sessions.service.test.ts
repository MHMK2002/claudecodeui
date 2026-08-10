import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { AppError } from '@/shared/utils.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-service-'));

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

test('session context distinguishes a root session from its subagent transcript', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/session-context';
    sessionsDb.createSession('parent-session', 'codex', projectPath, 'Parent Session');
    sessionsDb.createSubagentSession({
      agentSessionId: 'agent-session',
      provider: 'codex',
      parentSessionId: 'parent-session',
      projectPath,
      jsonlPath: '/transcripts/agent-session.jsonl',
      agentType: 'dispatch',
      customName: 'Noether',
    });

    const project = projectsDb.getProjectPath(projectPath);
    assert.ok(project);

    assert.deepEqual(sessionsService.getSessionContext('parent-session'), {
      sessionId: 'parent-session',
      provider: 'codex',
      providerProfileId: null,
      projectId: project.project_id,
      projectPath,
      title: 'Parent Session',
      parentSessionId: null,
      agentType: null,
      isSubagent: false,
      forkContext: null,
      forkContextConsumed: false,
    });

    assert.deepEqual(sessionsService.getSessionContext('agent-session'), {
      sessionId: 'agent-session',
      provider: 'codex',
      providerProfileId: null,
      projectId: project.project_id,
      projectPath,
      title: 'Noether',
      parentSessionId: 'parent-session',
      agentType: 'dispatch',
      isSubagent: true,
      forkContext: null,
      forkContextConsumed: false,
    });
  });
});

test('session context rejects unknown ids', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    assert.throws(
      () => sessionsService.getSessionContext('missing-session'),
      (error: unknown) => error instanceof AppError && error.code === 'SESSION_NOT_FOUND',
    );
  });
});

test('forkSession without overrides inherits the source provider + profile', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/fork-inherit';
    sessionsDb.createAppSession('src', 'claude', projectPath, 7);

    const forked = await sessionsService.forkSession('src');
    assert.equal(forked.provider, 'claude');
    assert.equal(forked.providerProfileId, 7);
    assert.equal(forked.projectPath, projectPath);
    assert.notEqual(forked.sessionId, 'src');
    // No history on the source → nothing to carry.
    assert.equal(forked.forkContextCarried, false);

    const stored = sessionsDb.getSessionById(forked.sessionId);
    assert.ok(stored);
    assert.equal(stored.provider, 'claude');
    assert.equal(stored.provider_profile_id, 7);
    assert.equal(stored.project_path, projectPath);
    assert.equal(stored.fork_context, null);
    assert.equal(stored.fork_context_consumed, 0);
  });
});

test('forkSession with explicit provider override creates a session on the new provider', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/fork-override';
    sessionsDb.createAppSession('src', 'claude', projectPath, 7);

    const forked = await sessionsService.forkSession('src', { provider: 'codex', providerProfileId: 3 });
    assert.equal(forked.provider, 'codex');
    assert.equal(forked.providerProfileId, 3);
    assert.equal(forked.projectPath, projectPath);

    const stored = sessionsDb.getSessionById(forked.sessionId);
    assert.ok(stored);
    assert.equal(stored.provider, 'codex');
    assert.equal(stored.provider_profile_id, 3);
  });
});

test('forkSession with null providerProfileId forces Local CLI on the forked session', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/fork-local';
    sessionsDb.createAppSession('src', 'claude', projectPath, 7);

    const forked = await sessionsService.forkSession('src', { providerProfileId: null });
    assert.equal(forked.provider, 'claude');
    assert.equal(forked.providerProfileId, null);

    const stored = sessionsDb.getSessionById(forked.sessionId);
    assert.ok(stored);
    assert.equal(stored.provider_profile_id, null);
  });
});

test('forkSession refuses unsupported providers', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('src', 'claude', '/workspace/fork-unsupported', null);

    await assert.rejects(
      // @ts-expect-error — intentionally passing an unsupported provider to
      // validate the runtime guard, not the type contract.
      sessionsService.forkSession('src', { provider: 'unknown-provider' }),
      (error: unknown) => error instanceof AppError && error.code === 'UNSUPPORTED_PROVIDER',
    );
  });
});

test('forkSession refuses to fork a sub-agent transcript', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/fork-subagent';
    sessionsDb.createAppSession('parent', 'claude', projectPath, null);
    sessionsDb.createSubagentSession({
      agentSessionId: 'child',
      provider: 'claude',
      parentSessionId: 'parent',
      projectPath,
      jsonlPath: '/transcripts/child.jsonl',
      agentType: 'dispatch',
      customName: 'Worker',
    });

    await assert.rejects(
      sessionsService.forkSession('child'),
      (error: unknown) => error instanceof AppError && error.code === 'SESSION_FORK_NOT_ALLOWED',
    );
  });
});

test('forkSession with carryContext disabled never attempts to carry context', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/fork-no-carry';
    sessionsDb.createAppSession('src', 'claude', projectPath, null);

    const forked = await sessionsService.forkSession('src', { carryContext: false });
    assert.equal(forked.forkContextCarried, false);
    const stored = sessionsDb.getSessionById(forked.sessionId);
    assert.ok(stored);
    assert.equal(stored.fork_context, null);
  });
});

test('forkSession surfaces carried context via getSessionContext and marks it unconsumed', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/fork-context-expose';
    sessionsDb.createAppSession('src', 'claude', projectPath, null);
    const forked = await sessionsService.forkSession('src', { carryContext: false });

    // Simulate the summarizer having written a handoff summary onto the row.
    sessionsDb.setForkContext(forked.sessionId, '## Goal\nShip the fork feature.');

    const context = sessionsService.getSessionContext(forked.sessionId);
    assert.equal(context.forkContext, '## Goal\nShip the fork feature.');
    assert.equal(context.forkContextConsumed, false);

    sessionsDb.markForkContextConsumed(forked.sessionId);
    const after = sessionsService.getSessionContext(forked.sessionId);
    assert.equal(after.forkContextConsumed, true);
  });
});

test('provider session id returns the mapped native id', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session-id', 'codex', '/tmp/session-id-copy-project');
    sessionsDb.assignProviderSessionId('app-session-id', 'codex-native-session-id');

    assert.equal(sessionsService.getProviderSessionId('app-session-id'), 'codex-native-session-id');
  });
});

test('provider session id is unavailable until the provider assigns one', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('pending-app-session', 'claude', '/tmp/session-id-copy-project');

    assert.throws(
      () => sessionsService.getProviderSessionId('pending-app-session'),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number };
        return typedError.code === 'PROVIDER_SESSION_ID_NOT_AVAILABLE' && typedError.statusCode === 409;
      },
    );
  });
});

test('provider session id reports a missing app session', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    assert.throws(
      () => sessionsService.getProviderSessionId('missing-session'),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number };
        return typedError.code === 'SESSION_NOT_FOUND' && typedError.statusCode === 404;
      },
    );
  });
});
