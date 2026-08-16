import assert from 'node:assert/strict';
import test from 'node:test';

import { nextRunAt } from '../cron.js';

test('timezone-aware next run keeps 09:30 across spring DST', () => {
  const before = nextRunAt('30 9 * * *', 'America/New_York', new Date('2026-03-07T15:00:00.000Z'));
  const after = nextRunAt('30 9 * * *', 'America/New_York', before);
  assert.equal(before.toISOString(), '2026-03-08T13:30:00.000Z');
  assert.equal(after.toISOString(), '2026-03-09T13:30:00.000Z');
});

test('timezone-aware next run skips a nonexistent DST wall time', () => {
  const run = nextRunAt('30 2 * * *', 'America/New_York', new Date('2026-03-08T05:00:00.000Z'));
  assert.equal(run.toISOString(), '2026-03-09T06:30:00.000Z');
});
