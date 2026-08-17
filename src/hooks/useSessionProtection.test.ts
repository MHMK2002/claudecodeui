import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySessionIdle,
  applySessionProcessing,
  getViewedSessionActivity,
} from './useSessionProtection';

test('status and stream evidence keep one running activity across reconnect', () => {
  let activities = applySessionProcessing(new Map(), 'session-a', {
    statusText: 'Reading files',
    canInterrupt: true,
  }, 100);
  activities = applySessionProcessing(activities, 'session-a');

  assert.deepEqual(activities.get('session-a'), {
    statusText: 'Reading files',
    canInterrupt: true,
    requiresUserInput: false,
    startedAt: 100,
  });
});

test('session switching resolves Stop only for the viewed running session', () => {
  const activities = applySessionProcessing(new Map(), 'session-a', {}, 100);
  assert.ok(getViewedSessionActivity(activities, 'session-a'));
  assert.equal(getViewedSessionActivity(activities, 'session-b'), null);
});

test('complete and abort both return the session to idle while stale reconnect idle is ignored', () => {
  const running = applySessionProcessing(new Map(), 'session-a', {}, 200);
  assert.equal(applySessionIdle(running, 'session-a', { ifStartedBefore: 100 }).has('session-a'), true);
  assert.equal(applySessionIdle(running, 'session-a').has('session-a'), false);
  const restarted = applySessionProcessing(new Map(), 'session-a', {}, 300);
  assert.equal(applySessionIdle(restarted, 'session-a').has('session-a'), false);
});

test('waiting for user input persists until provider work explicitly resumes', () => {
  let activities = applySessionProcessing(new Map(), 'session-a', {
    requiresUserInput: true,
  }, 100);
  activities = applySessionProcessing(activities, 'session-a');
  assert.equal(activities.get('session-a')?.requiresUserInput, true);

  activities = applySessionProcessing(activities, 'session-a', {
    requiresUserInput: false,
  });
  assert.equal(activities.get('session-a')?.requiresUserInput, false);
});
