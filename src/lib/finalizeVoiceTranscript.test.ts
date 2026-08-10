import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizeVoiceTranscript } from './finalizeVoiceTranscript';

test('delivers one committed transcript exactly once', async () => {
  const deliveries: Array<{ text: string; send?: boolean; origin?: unknown }> = [];
  const origin = { sessionId: 'session-a' };

  const result = await finalizeVoiceTranscript({
    rawText: ' raw transcript\n',
    send: true,
    origin,
    onTranscript: (text, send, capturedOrigin) => {
      deliveries.push({ text, send, origin: capturedOrigin });
    },
  });

  assert.equal(result, 'delivered');
  assert.deepEqual(deliveries, [{ text: ' raw transcript\n', send: true, origin }]);
});

test('does not deliver an empty transcript', async () => {
  let deliveryCount = 0;

  const result = await finalizeVoiceTranscript({
    rawText: ' \n ',
    send: false,
    onTranscript: () => {
      deliveryCount += 1;
    },
  });

  assert.equal(result, 'empty');
  assert.equal(deliveryCount, 0);
});

test('does not deliver when already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  let deliveryCount = 0;

  const result = await finalizeVoiceTranscript({
    rawText: 'keep this exact',
    send: true,
    signal: controller.signal,
    onTranscript: () => {
      deliveryCount += 1;
    },
  });

  assert.equal(result, 'cancelled');
  assert.equal(deliveryCount, 0);
});

test('awaits async delivery and reports generation ownership from ownsUi', async () => {
  let releaseDelivery: (() => void) | undefined;
  let resolved = false;
  let receivedOwnsUi: boolean | undefined;

  const pending = finalizeVoiceTranscript({
    rawText: 'transcript',
    send: true,
    ownsUi: () => false,
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

  // ownsUi is forwarded to the delivery object and delivery is pending.
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
      onTranscript: async () => {
        deliveryCount += 1;
        throw new Error('delivery failed');
      },
    }),
    /delivery failed/,
  );
  assert.equal(deliveryCount, 1);
});
