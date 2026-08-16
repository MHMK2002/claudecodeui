import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchWebSocketMessage } from './webSocketDispatch';

test('closed sockets reject a frame without calling send', () => {
  let calls = 0;
  const result = dispatchWebSocketMessage({
    readyState: 3,
    send: () => { calls += 1; },
  }, 1, { type: 'chat.send' });

  assert.deepEqual(result, { ok: false, reason: 'not-connected' });
  assert.equal(calls, 0);
});

test('open sockets report synchronous send acceptance', () => {
  const payloads: string[] = [];
  const result = dispatchWebSocketMessage({
    readyState: 1,
    send: (payload) => payloads.push(payload),
  }, 1, { type: 'chat.send', content: 'kept' });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(payloads, ['{"type":"chat.send","content":"kept"}']);
});

test('synchronous socket errors become typed failures', () => {
  const result = dispatchWebSocketMessage({
    readyState: 1,
    send: () => { throw new Error('closed during send'); },
  }, 1, { type: 'chat.abort' });

  assert.deepEqual(result, { ok: false, reason: 'send-failed' });
});
