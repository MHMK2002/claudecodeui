import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getActionMenuFocusIndex,
  shouldActionMenuCloseWithoutFocusReturn,
} from './ActionMenu';

const enabled = [true, false, true, true];

test('ActionMenu Arrow keys wrap and skip disabled items', () => {
  assert.equal(getActionMenuFocusIndex(enabled, 0, 'ArrowDown'), 2);
  assert.equal(getActionMenuFocusIndex(enabled, 3, 'ArrowDown'), 0);
  assert.equal(getActionMenuFocusIndex(enabled, -1, 'ArrowDown'), 0);
  assert.equal(getActionMenuFocusIndex(enabled, 2, 'ArrowUp'), 0);
  assert.equal(getActionMenuFocusIndex(enabled, 0, 'ArrowUp'), 3);
  assert.equal(getActionMenuFocusIndex(enabled, -1, 'ArrowUp'), 3);
});

test('ActionMenu Tab and Shift+Tab close through normal focus order', () => {
  assert.equal(shouldActionMenuCloseWithoutFocusReturn('Tab'), true);
  assert.equal(shouldActionMenuCloseWithoutFocusReturn('Escape'), false);
});

test('ActionMenu Home and End move to the first and last enabled items', () => {
  assert.equal(getActionMenuFocusIndex(enabled, 2, 'Home'), 0);
  assert.equal(getActionMenuFocusIndex(enabled, 0, 'End'), 3);
  assert.equal(getActionMenuFocusIndex([false, false], -1, 'Home'), -1);
});
