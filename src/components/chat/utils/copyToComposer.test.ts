import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeCopiedMessageIntoDraft } from './copyToComposer';

test('copy to composer preserves an existing draft and appends the reused prompt', () => {
  assert.equal(
    mergeCopiedMessageIntoDraft('unfinished draft  \n', '  previous prompt'),
    'unfinished draft\n\nprevious prompt',
  );
});

test('copy to composer uses the historic prompt directly when the draft is empty', () => {
  assert.equal(mergeCopiedMessageIntoDraft('', 'previous prompt'), 'previous prompt');
});
