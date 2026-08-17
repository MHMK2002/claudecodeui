import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { WebSocket } from 'ws';

import {
  closeConnection,
  initializeDatabase,
  providerProfilesDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import { handleChatSend } from '@/modules/websocket/services/chat-websocket.service.js';
import type { AnyRecord } from '@/shared/types.js';

type SentFrame = {
  kind?: string;
  code?: string;
  error?: string;
  sessionId?: string | null;
};

function createFakeSocket(sent: SentFrame[]): WebSocket {
  return {
    readyState: 1,
    send(payload: unknown) {
      sent.push(JSON.parse(String(payload)) as SentFrame);
    },
  } as unknown as WebSocket;
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-send-gateway-'));

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

const runtimeThatMustNotBeReached = {
  hasRuntime: () => true,
  run: () => {
    throw new Error('Provider runtime must not be reached when validation fails.');
  },
  abort: async () => false,
  resolveToolApproval: () => {},
  getPendingApprovalsForSession: () => [],
};

test('chat.send blocks a disconnected profile-less Claude session before consuming fork context or starting a run', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    // A profile-less Claude row with no live CLI connection, carrying an
    // unconsumed fork context so the test proves validation happens first.
    sessionsDb.createAppSession('legacy-claude', 'claude', '/workspace/legacy', null, null);
    sessionsDb.setForkContext('legacy-claude', 'unconsumed handoff summary');

    const sent: SentFrame[] = [];
    await handleChatSend(
      createFakeSocket(sent),
      1,
      { sessionId: 'legacy-claude', content: 'hello' } as AnyRecord,
      { runtime: runtimeThatMustNotBeReached },
    );

    assert.equal(sent.length, 1);
    assert.equal(sent[0].kind, 'protocol_error');
    assert.equal(sent[0].code, 'PROVIDER_NOT_CONNECTED');
    assert.equal(sent[0].sessionId, 'legacy-claude');

    // Fork context must remain unconsumed — validation fired first.
    const row = sessionsDb.getSessionById('legacy-claude');
    assert.ok(row);
    assert.equal(row.fork_context_consumed, 0);
    assert.equal(row.fork_context, 'unconsumed handoff summary');
  });
});

test('chat.send blocks a Claude session whose profile no longer exists', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('orphan-claude', 'claude', '/workspace/orphan', 42, 'claude-sonnet');

    const sent: SentFrame[] = [];
    await handleChatSend(
      createFakeSocket(sent),
      1,
      { sessionId: 'orphan-claude', content: 'hello' } as AnyRecord,
      { runtime: runtimeThatMustNotBeReached },
    );

    assert.equal(sent.length, 1);
    assert.equal(sent[0].code, 'PROVIDER_PROFILE_NOT_FOUND');
  });
});

test('chat.send still reaches the runtime for a session with a valid active profile', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const user = userDb.createUser('gateway-tester', 'irrelevant-hash');
    const profile = providerProfilesDb.createClaudeProfile(Number(user.id), {
      title: 'Main',
      baseUrl: null,
      authType: 'auth_token',
      secretValue: 'sk-test-token',
      isDefault: true,
    });
    sessionsDb.createAppSession('valid-claude', 'claude', '/workspace/valid', profile.id, 'claude-sonnet');
    sessionsDb.setForkContext('valid-claude', 'carried summary');

    const runs: unknown[][] = [];
    const sent: SentFrame[] = [];
    await handleChatSend(
      createFakeSocket(sent),
      Number(user.id),
      { sessionId: 'valid-claude', content: 'hello' } as AnyRecord,
      {
        runtime: {
          ...runtimeThatMustNotBeReached,
          run: async (_provider, command, options, runWriter) => {
            runs.push([command, options, runWriter]);
            return undefined;
          },
        },
      },
    );

    // No protocol error; the fork context was consumed as part of the run path.
    assert.deepEqual(
      sent.filter((frame) => frame.kind === 'protocol_error'),
      [],
    );
    assert.equal(runs.length, 1);
    assert.match(String(runs[0][0]), /carried summary/);
    const row = sessionsDb.getSessionById('valid-claude');
    assert.ok(row);
    assert.equal(row.fork_context_consumed, 1);
  });
});
