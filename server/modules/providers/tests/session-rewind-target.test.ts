import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  resolveSessionRewindBoundary,
  SessionRewindTargetError,
} from '@/modules/providers/services/session-rewind-target.js';

async function withTranscript(
  rows: Array<Record<string, unknown>>,
  runTest: (jsonlPath: string) => void | Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'session-rewind-target-'));
  const jsonlPath = path.join(directory, 'session.jsonl');
  await writeFile(jsonlPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  try {
    await runTest(jsonlPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('Claude boundary drops the selected user prompt and retains its parent', async () => {
  await withTranscript([
    { uuid: 'user-first', parentUuid: null, message: { role: 'user', content: 'first' } },
    { uuid: 'assistant-first', parentUuid: 'user-first', message: { role: 'assistant' } },
    { uuid: 'user-second', parentUuid: 'assistant-first', message: { role: 'user', content: 'second' } },
  ], async (jsonlPath) => {
    assert.deepEqual(await resolveSessionRewindBoundary(jsonlPath, 'claude', 'user-first'), {
      provider: 'claude',
      targetMessageId: 'user-first',
      providerTargetId: 'user-first',
      forkPointId: null,
    });
    assert.deepEqual(await resolveSessionRewindBoundary(jsonlPath, 'claude', 'user-second'), {
      provider: 'claude',
      targetMessageId: 'user-second',
      providerTargetId: 'user-second',
      forkPointId: 'assistant-first',
    });
  });
});

test('Codex boundary uses the previous distinct turn and rejects an in-turn steer', async () => {
  const firstTimestamp = '2026-08-06T08:00:00.000Z';
  const secondTimestamp = '2026-08-06T08:01:00.000Z';
  const steerTimestamp = '2026-08-06T08:01:30.000Z';
  await withTranscript([
    { type: 'turn_context', payload: { turn_id: 'turn-1' } },
    { timestamp: firstTimestamp, type: 'event_msg', payload: { type: 'user_message', message: 'first' } },
    { type: 'turn_context', payload: { turn_id: 'turn-2' } },
    { timestamp: secondTimestamp, type: 'event_msg', payload: { type: 'user_message', message: 'second' } },
    { timestamp: steerTimestamp, type: 'event_msg', payload: { type: 'user_message', message: 'steer' } },
  ], async (jsonlPath) => {
    assert.deepEqual(
      await resolveSessionRewindBoundary(
        jsonlPath,
        'codex',
        `codex_ts_${Date.parse(firstTimestamp)}`,
      ),
      {
        provider: 'codex',
        targetMessageId: `codex_ts_${Date.parse(firstTimestamp)}`,
        providerTargetId: 'turn-1',
        forkPointId: null,
      },
    );
    assert.deepEqual(
      await resolveSessionRewindBoundary(jsonlPath, 'codex', 'codex_turn_turn-2'),
      {
        provider: 'codex',
        targetMessageId: 'codex_turn_turn-2',
        providerTargetId: 'turn-2',
        forkPointId: 'turn-1',
      },
    );
    await assert.rejects(
      resolveSessionRewindBoundary(
        jsonlPath,
        'codex',
        `codex_ts_${Date.parse(steerTimestamp)}`,
      ),
      (error: unknown) => (
        error instanceof SessionRewindTargetError
        && error.code === 'REWIND_TARGET_AMBIGUOUS'
      ),
    );
  });
});

test('boundary resolver ignores meta rows and reports missing targets', async () => {
  await withTranscript([
    { uuid: 'meta-user', isMeta: true, message: { role: 'user', content: 'hidden' } },
  ], async (jsonlPath) => {
    await assert.rejects(
      resolveSessionRewindBoundary(jsonlPath, 'claude', 'meta-user'),
      (error: unknown) => (
        error instanceof SessionRewindTargetError
        && error.code === 'REWIND_TARGET_NOT_FOUND'
      ),
    );
  });
});
