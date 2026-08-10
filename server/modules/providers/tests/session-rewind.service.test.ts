import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionRewindService } from '@/modules/providers/services/session-rewind.service.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

class FakeConnection {
  readyState = 1;
  send(): void {}
}

async function withIsolatedDatabase(
  runTest: (directory: string) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'session-rewind-service-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    await runTest(directory);
  } finally {
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(directory, { recursive: true, force: true });
  }
}

test('active sessions reject rewind preview with 409 instead of fake-cancelling the run', { concurrency: false }, async () => {
  await withIsolatedDatabase(async (directory) => {
    const jsonlPath = path.join(directory, 'active.jsonl');
    await writeFile(jsonlPath, `${JSON.stringify({
      uuid: 'user-active',
      parentUuid: null,
      message: { role: 'user', content: 'active' },
    })}\n`);
    sessionsDb.createSession(
      'provider-active',
      'claude',
      '/workspace/active-rewind',
      'Active',
      undefined,
      undefined,
      jsonlPath,
    );
    const run = chatRunRegistry.startRun({
      appSessionId: 'provider-active',
      provider: 'claude',
      providerSessionId: 'provider-active',
      connection: new FakeConnection() as unknown as RealtimeClientConnection,
      userId: null,
    });
    assert.ok(run);

    await assert.rejects(
      sessionRewindService.preview('provider-active', 'user-active'),
      (error: unknown) => (
        error instanceof AppError
        && error.statusCode === 409
        && error.code === 'SESSION_RUN_IN_PROGRESS'
      ),
    );
    assert.equal(chatRunRegistry.isProcessing('provider-active'), true);
  });
});

test('Codex preview is conversation-only', { concurrency: false }, async () => {
  await withIsolatedDatabase(async (directory) => {
    const timestamp = '2026-08-06T09:00:00.000Z';
    const jsonlPath = path.join(directory, 'codex.jsonl');
    await writeFile(jsonlPath, [
      JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-1' } }),
      JSON.stringify({
        timestamp,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'hello' },
      }),
    ].join('\n'));
    sessionsDb.createSession(
      'codex-preview',
      'codex',
      '/workspace/codex-preview',
      'Codex',
      undefined,
      undefined,
      jsonlPath,
    );

    const preview = await sessionRewindService.preview(
      'codex-preview',
      `codex_ts_${Date.parse(timestamp)}`,
    );
    assert.equal(preview.provider, 'codex');
    assert.equal(preview.canRestoreConversation, true);
    assert.equal(preview.canRestoreFiles, false);
    assert.deepEqual(preview.filesChanged, []);
  });
});

test('provider fork failure leaves the current Codex binding untouched', { concurrency: false }, async () => {
  await withIsolatedDatabase(async (directory) => {
    const previousPath = process.env.PATH;
    const jsonlPath = path.join(directory, 'codex-failure.jsonl');
    const targetTimestamp = '2026-08-06T10:01:00.000Z';
    await writeFile(jsonlPath, [
      JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-1' } }),
      JSON.stringify({
        timestamp: '2026-08-06T10:00:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'first' },
      }),
      JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-2' } }),
      JSON.stringify({
        timestamp: targetTimestamp,
        type: 'event_msg',
        payload: { type: 'user_message', message: 'second' },
      }),
    ].join('\n'));
    sessionsDb.createSession(
      'codex-current',
      'codex',
      '/workspace/codex-failure',
      'Stable Codex chat',
      undefined,
      undefined,
      jsonlPath,
    );

    process.env.PATH = directory;
    try {
      await assert.rejects(sessionRewindService.rewind('codex-current', {
        messageId: `codex_ts_${Date.parse(targetTimestamp)}`,
        mode: 'conversation',
      }));
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }

    const session = sessionsDb.getSessionById('codex-current');
    assert.equal(session?.provider_session_id, 'codex-current');
    assert.equal(session?.jsonl_path, jsonlPath);
    assert.equal(session?.custom_name, 'Stable Codex chat');
    assert.deepEqual(sessionsDb.listProviderBranches('codex-current'), []);

    const previewAfterFailure = await sessionRewindService.preview(
      'codex-current',
      `codex_ts_${Date.parse(targetTimestamp)}`,
    );
    assert.equal(previewAfterFailure.canRestoreConversation, true);
  });
});
