import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NormalizedMessage,
  SessionHistoryResult,
  SessionHistorySnapshot,
  SessionSlot,
} from '../../../stores/useSessionStore';

import {
  resolveLoadAllHistoryCompletion,
  resolveLoadOlderHistoryCompletion,
  resolveSessionPaginationSnapshot,
  ownsSessionHistoryView,
} from './sessionHistory';

const messages: NormalizedMessage[] = Array.from({ length: 4 }, (_, index) => ({
  id: `message-${index + 1}`,
  sessionId: 'session-1',
  timestamp: `2026-08-16T00:00:0${index}.000Z`,
  provider: 'codex',
  kind: 'text',
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `Message ${index + 1}`,
}));

function makeSlot(overrides: Partial<SessionSlot> = {}): SessionSlot {
  return {
    serverMessages: messages,
    realtimeMessages: [],
    merged: messages,
    _lastServerRef: messages,
    _lastRealtimeRef: [],
    _fetchSeq: 1,
    _appliedFetchSeq: 1,
    status: 'idle',
    error: null,
    fetchedAt: Date.now(),
    total: 4,
    hasMore: false,
    offset: 4,
    tokenUsage: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<SessionHistorySnapshot> = {}): SessionHistorySnapshot {
  return {
    serverMessages: messages,
    realtimeMessages: [],
    merged: messages,
    total: 4,
    hasMore: false,
    offset: 4,
    tokenUsage: null,
    ...overrides,
  };
}

function makeSuccess(overrides: Partial<Extract<SessionHistoryResult, { ok: true }>> = {}): Extract<SessionHistoryResult, { ok: true }> {
  return {
    ok: true,
    applied: true,
    superseded: false,
    slot: makeSlot(),
    snapshot: makeSnapshot(),
    receivedCount: 4,
    ...overrides,
  };
}

test('load-all failure resets completion and overlay state while preserving its recovery error', () => {
  const failure: SessionHistoryResult = {
    ok: false,
    applied: true,
    superseded: false,
    slot: makeSlot(),
    error: 'Could not load this conversation.',
    cause: 'network',
  };

  assert.deepEqual(resolveLoadAllHistoryCompletion(failure), {
    complete: false,
    showOverlay: false,
    total: null,
    error: 'Could not load this conversation.',
  });
});

test('load-all accepts only an applied, complete request-specific snapshot', () => {
  assert.deepEqual(resolveLoadAllHistoryCompletion(makeSuccess()), {
    complete: true,
    showOverlay: true,
    total: 4,
    error: null,
  });

  assert.deepEqual(resolveLoadAllHistoryCompletion(makeSuccess({
    applied: false,
    superseded: true,
  })), {
    complete: false,
    showOverlay: false,
    total: null,
    error: 'Conversation history changed while it was loading. Try again.',
  });

  assert.deepEqual(resolveLoadAllHistoryCompletion(makeSuccess({
    snapshot: makeSnapshot({ hasMore: true }),
  })), {
    complete: false,
    showOverlay: false,
    total: null,
    error: 'Could not load the complete conversation. Try again.',
  });
});

test('load-older exposes an applied page without deriving state from the mutable slot', () => {
  const mutableSlot = makeSlot({ total: 99, hasMore: true });
  const result = makeSuccess({
    slot: mutableSlot,
    receivedCount: 2,
    snapshot: makeSnapshot({
      serverMessages: messages,
      total: 4,
      hasMore: false,
    }),
  });

  assert.deepEqual(resolveLoadOlderHistoryCompletion(result), {
    applied: true,
    addedCount: 2,
    hasMore: false,
    total: 4,
    allLoaded: true,
    error: null,
  });
});

test('load-older makes no pagination or scroll-eligible transition for failures or superseded pages', () => {
  const failure: SessionHistoryResult = {
    ok: false,
    applied: true,
    superseded: false,
    slot: makeSlot(),
    error: 'Could not load earlier messages. Check your connection and try again.',
    cause: 'http',
  };
  assert.deepEqual(resolveLoadOlderHistoryCompletion(failure), {
    applied: false,
    error: 'Could not load earlier messages. Check your connection and try again.',
  });

  assert.deepEqual(resolveLoadOlderHistoryCompletion(makeSuccess({
    applied: false,
    superseded: true,
  })), {
    applied: false,
    error: null,
  });
});

test('header full-history hydration updates Chat pagination only for an exact complete slot', () => {
  assert.deepEqual(resolveSessionPaginationSnapshot(makeSlot()), {
    hasMore: false,
    total: 4,
    allLoaded: true,
  });

  assert.deepEqual(resolveSessionPaginationSnapshot(makeSlot({
    serverMessages: [...messages, messages[0]],
  })), {
    hasMore: false,
    total: 4,
    allLoaded: false,
  });
});

test('a delayed page cannot own a newer session or project view', async () => {
  let release!: () => void;
  const deferred = new Promise<void>((resolve) => { release = resolve; });
  const request = { sessionId: 'session-a', projectId: 'project-a', generation: 4 };
  let current = { sessionId: 'session-a' as string | null, projectId: 'project-a' as string | null, generation: 4 };
  const completion = deferred.then(() => ownsSessionHistoryView(request, current));

  current = { sessionId: 'session-b', projectId: 'project-b', generation: 5 };
  release();

  assert.equal(await completion, false);
  assert.equal(ownsSessionHistoryView(request, {
    sessionId: 'session-a',
    projectId: 'project-a',
    generation: 4,
  }), true);
});
