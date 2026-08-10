import assert from 'node:assert/strict';
import test from 'node:test';

import { runSingleFlight } from './single-flight';

test('same-tick starts share one operation and a rejected operation is retryable', async () => {
  let calls = 0;
  let release: ((value: string) => void) | undefined;
  const operation = () => {
    calls += 1;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  };

  const first = runSingleFlight('project:task-1', operation);
  const second = runSingleFlight('project:task-1', operation);
  assert.equal(calls, 1);
  assert.equal(first, second);
  release?.('session-1');
  assert.deepEqual(await Promise.all([first, second]), ['session-1', 'session-1']);

  await assert.rejects(runSingleFlight('project:task-1', async () => {
    calls += 1;
    throw new Error('allocation failed');
  }));
  const retried = await runSingleFlight('project:task-1', async () => {
    calls += 1;
    return 'session-2';
  });
  assert.equal(retried, 'session-2');
  assert.equal(calls, 3);
});
