import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebSocket } from 'ws';

import { rejectTransactionalEdit } from '@/modules/websocket/services/chat-websocket.service.js';
import type { AnyRecord } from '@/shared/types.js';

test('forged WebSocket edit request is rejected without invoking a mutation dependency', () => {
  const frames: AnyRecord[] = [];
  const socket = {
    readyState: 1,
    send(payload: unknown) {
      frames.push(JSON.parse(String(payload)) as AnyRecord);
    },
  } as unknown as WebSocket;

  rejectTransactionalEdit(socket, { sessionId: 'session-1' });

  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.kind, 'protocol_error');
  assert.equal(frames[0]?.code, 'TRANSACTIONAL_EDIT_UNAVAILABLE');
  assert.equal(
    frames[0]?.error,
    'Transactional edit and resubmit is unavailable. Copy the message to the composer instead.',
  );
  assert.equal(frames[0]?.sessionId, 'session-1');
  assert.equal(typeof frames[0]?.timestamp, 'string');
});
