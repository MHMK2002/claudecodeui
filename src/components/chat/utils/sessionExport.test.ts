import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NormalizedMessage,
  SessionHistoryResult,
  SessionHistorySnapshot,
  SessionSlot,
} from '../../../stores/useSessionStore';

import { hydrateSessionMessagesForExport } from './sessionExport';

const fullMessage: NormalizedMessage = {
  id: 'message-1',
  sessionId: 'session-1',
  timestamp: '2026-08-16T00:00:00.000Z',
  provider: 'codex',
  kind: 'text',
  role: 'user',
  content: 'Full history',
};

function makeSlot(overrides: Partial<SessionSlot> = {}): SessionSlot {
  const serverMessages = [fullMessage];
  return {
    serverMessages,
    realtimeMessages: [],
    merged: serverMessages,
    _lastServerRef: serverMessages,
    _lastRealtimeRef: [],
    _fetchSeq: 1,
    _appliedFetchSeq: 1,
    status: 'idle',
    error: null,
    fetchedAt: Date.now(),
    total: 1,
    hasMore: false,
    offset: 1,
    tokenUsage: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<SessionHistorySnapshot> = {}): SessionHistorySnapshot {
  return Object.freeze({
    serverMessages: Object.freeze([Object.freeze({ ...fullMessage })]),
    realtimeMessages: Object.freeze([]),
    merged: Object.freeze([Object.freeze({ ...fullMessage })]),
    total: 1,
    hasMore: false,
    offset: 1,
    tokenUsage: null,
    ...overrides,
  });
}

function makeSuccess(overrides: Partial<Extract<SessionHistoryResult, { ok: true }>> = {}): Extract<SessionHistoryResult, { ok: true }> {
  return {
    ok: true,
    applied: true,
    superseded: false,
    slot: makeSlot(),
    snapshot: makeSnapshot(),
    receivedCount: 1,
    ...overrides,
  };
}

test('local export aborts when full-history hydration fails', async () => {
  const calls: unknown[] = [];
  const failure: SessionHistoryResult = {
    ok: false,
    applied: true,
    superseded: false,
    slot: makeSlot(),
    error: 'Could not load the complete conversation.',
    cause: 'invalid-json',
  };

  await assert.rejects(
    hydrateSessionMessagesForExport(async (...args) => {
      calls.push(args);
      return failure;
    }, 'session-1', () => 1),
    /Could not load the complete conversation\./,
  );
  assert.deepEqual(calls, [['session-1', { limit: null, offset: 0 }]]);
});

test('local export converts the applied immutable request snapshot, never the later mutable slot', async () => {
  const result = makeSuccess();
  result.slot.serverMessages = [];
  result.slot.merged = [];
  result.slot.total = 0;

  const hydrated = await hydrateSessionMessagesForExport(async () => result, 'session-1', () => 7);

  assert.equal(hydrated.messages.length, 1);
  assert.equal(hydrated.messages[0]?.content, 'Full history');
  assert.match(hydrated.transcriptDigest, /^[a-f0-9]{64}$/);
  assert.equal(hydrated.snapshotRevision, 7);
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.equal(Object.isFrozen(result.snapshot.merged), true);
});

test('local export rejects both hasMore and server-row/total inconsistencies', async (t) => {
  await t.test('hasMore remains true', async () => {
    await assert.rejects(
      hydrateSessionMessagesForExport(async () => makeSuccess({
        snapshot: makeSnapshot({ hasMore: true }),
      }), 'session-1', () => 1),
      /Export requires the complete conversation/,
    );
  });

  await t.test('server row count differs from total', async () => {
    await assert.rejects(
      hydrateSessionMessagesForExport(async () => makeSuccess({
        snapshot: makeSnapshot({ total: 2 }),
      }), 'session-1', () => 1),
      /Export requires the complete conversation/,
    );
  });
});

test('a delayed full request superseded by a later fetchMore aborts instead of exporting a partial slot', async () => {
  let resolveFullRequest: ((result: SessionHistoryResult) => void) | undefined;
  const delayedFullRequest = new Promise<SessionHistoryResult>((resolve) => {
    resolveFullRequest = resolve;
  });
  const exportPromise = hydrateSessionMessagesForExport(
    async () => delayedFullRequest,
    'session-1',
    () => 1,
  );

  // Model the later fetchMore having become the slot owner before the delayed
  // full request resolves. Its cached slot is intentionally partial.
  const partialSlot = makeSlot({
    serverMessages: [],
    merged: [],
    total: 1,
    hasMore: true,
  });
  resolveFullRequest?.(makeSuccess({
    applied: false,
    superseded: true,
    slot: partialSlot,
  }));

  await assert.rejects(
    exportPromise,
    /history changed while Export was loading/,
  );
});

test('export captures the session revision before asynchronous digest work yields', async () => {
  let revision = 11;
  let releaseDigest: ((value: string) => void) | undefined;
  const digest = new Promise<string>((resolve) => {
    releaseDigest = resolve;
  });

  const exportPromise = hydrateSessionMessagesForExport(
    async () => makeSuccess(),
    'session-1',
    () => revision,
    async () => digest,
  );
  await Promise.resolve();
  revision = 12;
  releaseDigest?.('a'.repeat(64));

  const snapshot = await exportPromise;
  assert.equal(snapshot.snapshotRevision, 11);
  assert.notEqual(snapshot.snapshotRevision, revision);
});
