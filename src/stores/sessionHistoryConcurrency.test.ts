import assert from 'node:assert/strict';
import test from 'node:test';

import { isSupersededSessionHistoryFetch } from './sessionHistoryConcurrency';

test('a delayed full-history request is superseded as soon as a later page starts', () => {
  const delayedFullHistoryRequest = 1;
  const laterFetchMoreRequest = 2;
  assert.equal(
    isSupersededSessionHistoryFetch(delayedFullHistoryRequest, laterFetchMoreRequest),
    true,
  );
});

test('the latest-started request remains eligible to apply', () => {
  assert.equal(isSupersededSessionHistoryFetch(3, 3), false);
});
