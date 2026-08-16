import assert from 'node:assert/strict';
import test from 'node:test';

import { nextCronRuns } from './cron.js';

test('nextCronRuns returns three increasing local-time matches across DST', () => {
  const runs = nextCronRuns(
    '30 9 * * *',
    'America/New_York',
    new Date('2026-03-06T15:00:00.000Z'),
    3,
  );
  assert.equal(runs.length, 3);
  assert.ok(runs[0].getTime() < runs[1].getTime());
  assert.ok(runs[1].getTime() < runs[2].getTime());

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  assert.deepEqual(runs.map((run) => formatter.format(run)), ['09:30', '09:30', '09:30']);
  assert.equal(runs[1].getTime() - runs[0].getTime(), 23 * 60 * 60_000);
});

test('nextCronRuns skips a nonexistent spring-forward wall time', () => {
  const [run] = nextCronRuns(
    '30 2 * * *',
    'America/New_York',
    new Date('2026-03-08T05:00:00.000Z'),
    1,
  );
  assert.equal(run.toISOString(), '2026-03-09T06:30:00.000Z');
});
