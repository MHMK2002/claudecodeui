import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionRevisionRegistry } from './sessionRevisionRegistry';

test('one store notification reaches independent Chat body and header subscribers', () => {
  const revisions = createSessionRevisionRegistry();
  const updates: string[] = [];
  const unsubscribeBody = revisions.subscribe('session-1', () => updates.push('body'));
  const unsubscribeHeader = revisions.subscribe('session-1', () => updates.push('header'));

  assert.equal(revisions.getSnapshot('session-1'), 0);
  revisions.notify('session-1');
  assert.equal(revisions.getSnapshot('session-1'), 1);
  assert.deepEqual(updates.sort(), ['body', 'header']);

  unsubscribeBody();
  unsubscribeHeader();
  revisions.notify('session-1');
  assert.deepEqual(updates.sort(), ['body', 'header']);
});

test('session revisions do not wake consumers viewing another session', () => {
  const revisions = createSessionRevisionRegistry();
  let updates = 0;
  revisions.subscribe('session-2', () => { updates += 1; });

  revisions.notify('session-1');
  assert.equal(updates, 0);
  assert.equal(revisions.getSnapshot('session-2'), 0);
});
