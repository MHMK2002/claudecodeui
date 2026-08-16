import assert from 'node:assert/strict';
import test from 'node:test';

import { collectQueuedAutoSendCandidates } from './useQueuedMessageAutoSend';

test('a background completion becomes an auto-send candidate', () => {
  const candidates = collectQueuedAutoSendCandidates(
    new Set(['session-a']),
    new Set(),
    new Set(),
    null,
  );

  assert.deepEqual([...candidates], ['session-a']);
});

test('a disconnected completion remains a candidate after reconnect rerenders', () => {
  const candidates = collectQueuedAutoSendCandidates(
    new Set(),
    new Set(),
    new Set(['session-a']),
    null,
  );

  assert.deepEqual([...candidates], ['session-a']);
});

test('active and newly running sessions retain their existing delivery owner', () => {
  const candidates = collectQueuedAutoSendCandidates(
    new Set(),
    new Set(['session-running']),
    new Set(['session-active', 'session-running', 'session-ready']),
    'session-active',
  );

  assert.deepEqual([...candidates], ['session-ready']);
});
