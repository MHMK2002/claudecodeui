import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizeVoiceTranscript } from './finalizeVoiceTranscript';

test('finalizes one committed transcript through cleanup and delivers exactly once', async () => {
  const cleanupCalls: string[] = [];
  const deliveries: Array<{ text: string; send?: boolean; origin?: unknown }> = [];
  const origin = { sessionId: 'session-a' };

  const result = await finalizeVoiceTranscript({
    rawText: ' raw transcript\n',
    send: true,
    origin,
    cleanup: async (text) => {
      cleanupCalls.push(text);
      return 'clean transcript';
    },
    onTranscript: (text, send, capturedOrigin) => {
      deliveries.push({ text, send, origin: capturedOrigin });
    },
  });

  assert.equal(result, 'delivered');
  assert.deepEqual(cleanupCalls, [' raw transcript\n']);
  assert.deepEqual(deliveries, [{ text: 'clean transcript', send: true, origin }]);
});

test('does not clean or deliver an empty transcript', async () => {
  let cleanupCount = 0;
  let deliveryCount = 0;

  const result = await finalizeVoiceTranscript({
    rawText: ' \n ',
    send: false,
    cleanup: async (text) => {
      cleanupCount += 1;
      return text;
    },
    onTranscript: () => {
      deliveryCount += 1;
    },
  });

  assert.equal(result, 'empty');
  assert.equal(cleanupCount, 0);
  assert.equal(deliveryCount, 0);
});

test('does not deliver when cancellation happens during cleanup', async () => {
  const controller = new AbortController();
  let deliveryCount = 0;

  const result = await finalizeVoiceTranscript({
    rawText: 'keep this exact',
    send: true,
    signal: controller.signal,
    cleanup: async (text) => {
      controller.abort();
      return text;
    },
    onTranscript: () => {
      deliveryCount += 1;
    },
  });

  assert.equal(result, 'cancelled');
  assert.equal(deliveryCount, 0);
});

test('awaits async delivery and reports generation ownership at delivery time', async () => {
  let releaseDelivery: (() => void) | undefined;
  let resolved = false;
  let ownsUi = true;
  let receivedOwnsUi: boolean | undefined;

  const pending = finalizeVoiceTranscript({
    rawText: 'transcript',
    send: true,
    ownsUi: () => ownsUi,
    cleanup: async (text) => text,
    onTranscript: async (_text, _send, _origin, delivery) => {
      receivedOwnsUi = delivery?.ownsUi;
      await new Promise<void>((resolve) => {
        releaseDelivery = resolve;
      });
    },
  }).then((result) => {
    resolved = true;
    return result;
  });

  ownsUi = false;
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(receivedOwnsUi, false);
  assert.equal(resolved, false);
  releaseDelivery?.();
  assert.equal(await pending, 'delivered');
});

test('propagates an async delivery failure after invoking it once', async () => {
  let deliveryCount = 0;

  await assert.rejects(
    finalizeVoiceTranscript({
      rawText: 'transcript',
      send: true,
      cleanup: async (text) => text,
      onTranscript: async () => {
        deliveryCount += 1;
        throw new Error('delivery failed');
      },
    }),
    /delivery failed/,
  );
  assert.equal(deliveryCount, 1);
});
