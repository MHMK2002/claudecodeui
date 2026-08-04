import assert from 'node:assert/strict';
import test from 'node:test';

import {
  prepareVoiceCleanup,
  validateAndRestoreVoiceCleanup,
  type VoiceCleanupRejectionReason,
} from './voiceCleanupGuard';

function assertRejected(
  rawText: string,
  candidate: string,
  expectedReason: VoiceCleanupRejectionReason,
): void {
  const result = validateAndRestoreVoiceCleanup(
    prepareVoiceCleanup(rawText),
    candidate,
  );
  assert.equal(result.accepted, false);
  assert.equal(result.reason, expectedReason);
  assert.equal(result.text, rawText);
}

test('masks technical tokens, negations, numbers, paths, URLs, flags, and quotes in order', () => {
  const rawText =
    'Do not change useVoiceInput, cleanup_model, api.client.call, gpt-4o-mini, ' +
    '/Users/me/app.ts, src/lib/api.ts, https://example.com/v1?q=2, --force, 3.14, ' +
    'یا نمی‌خواهم «متن ۴۲» و `literal_name` عوض شوند.';
  const prepared = prepareVoiceCleanup(rawText);

  const protectedValues = prepared.placeholders.map(({ value }) => value);
  assert.deepEqual(protectedValues, [
    'not',
    'useVoiceInput',
    'cleanup_model',
    'api.client.call',
    'gpt-4o-mini',
    '/Users/me/app.ts,',
    'src/lib/api.ts',
    'https://example.com/v1?q=2,',
    '--force',
    '3.14',
    'نمی‌خواهم',
    '«متن ۴۲»',
    '`literal_name`',
  ]);
  prepared.placeholders.forEach((placeholder, index) => {
    assert.equal(
      placeholder.token,
      `⟪${prepared.placeholderNamespace}${index.toString().padStart(4, '0')}⟫`,
    );
    assert.equal(prepared.maskedText.includes(placeholder.value), false);
  });
});

test('uses a collision-safe placeholder namespace', () => {
  const rawText = 'VOICE_CLEANUP_0_ must not collide with useVoiceInput';
  const prepared = prepareVoiceCleanup(rawText);

  assert.equal(prepared.placeholderNamespace, 'VOICE_CLEANUP_1_');
  assert.equal(prepared.placeholders.some(({ value }) => value === 'not'), true);
});

test('restores protected Persian and English content byte-for-byte after a small edit', () => {
  const rawText =
    'لطفاً useVoiceInput را تغییر نده و do not remove `--force` از مسیر /tmp/نمونه.txt';
  const prepared = prepareVoiceCleanup(rawText);
  const candidate = prepared.maskedText.replace('لطفاً', 'لطفاً،');
  const result = validateAndRestoreVoiceCleanup(prepared, candidate);

  assert.equal(result.accepted, true);
  assert.equal(
    result.text,
    'لطفاً، useVoiceInput را تغییر نده و do not remove `--force` از مسیر /tmp/نمونه.txt',
  );
});

test('rejects a missing placeholder with the exact raw fallback', () => {
  const rawText = 'Please do not rename useVoiceInput today.\n';
  const prepared = prepareVoiceCleanup(rawText);
  const candidate = prepared.maskedText.replace(prepared.placeholders[0].token, '');

  const result = validateAndRestoreVoiceCleanup(prepared, candidate);
  assert.deepEqual(result, {
    accepted: false,
    reason: 'placeholder_missing',
    text: rawText,
  });
});

test('rejects duplicate, reordered, and modified placeholders', () => {
  const rawText = 'Do not rename useVoiceInput to cleanup_model.';
  const prepared = prepareVoiceCleanup(rawText);
  const [first, second] = prepared.placeholders;

  assertRejected(
    rawText,
    `${prepared.maskedText} ${first.token}`,
    'placeholder_duplicate',
  );

  const reordered = prepared.maskedText
    .replace(first.token, '__FIRST__')
    .replace(second.token, first.token)
    .replace('__FIRST__', second.token);
  assertRejected(rawText, reordered, 'placeholder_reordered');

  const modified = prepared.maskedText.replace(first.token, `${first.token.slice(0, -1)}]`);
  assertRejected(rawText, modified, 'placeholder_modified');
});

test('rejects newly introduced semantic critical spans', () => {
  assertRejected(
    'please ship the release after all checks pass today',
    'please do not ship the release after all checks pass today',
    'protected_span_changed',
  );
  assertRejected(
    'please ship the release after all checks pass today',
    'please ship the release after all checks pass today --force',
    'protected_span_changed',
  );
  assertRejected(
    'please ship the release after all checks pass today',
    'please ship 2 releases after all checks pass today',
    'protected_span_changed',
  );
});

test('rejects unprotected lexical meaning reversals', () => {
  assertRejected(
    'لطفا این کار را انجام نده',
    'لطفا این کار را انجام بده',
    'lexical_change_unsafe',
  );
  assertRejected(
    'deploy production now',
    'delete production now',
    'lexical_change_unsafe',
  );
});

test('allows collapsing a repeated token but never removing the entire semantic run', () => {
  const rawText = 'please deploy deploy production after all checks pass today';
  const collapsed = validateAndRestoreVoiceCleanup(
    prepareVoiceCleanup(rawText),
    'please deploy production after all checks pass today',
  );
  assert.equal(collapsed.accepted, true);

  assertRejected(
    rawText,
    'please production after all checks pass today',
    'lexical_change_unsafe',
  );
});

test('rejects empty and out-of-range candidates', () => {
  assertRejected('alpha beta gamma delta', '  \n ', 'candidate_empty');
  assertRejected('alpha beta gamma delta', 'alpha', 'length_out_of_range');
  assertRejected(
    'alpha beta gamma delta',
    'alpha beta gamma delta alpha beta gamma delta',
    'length_out_of_range',
  );
});

test('accepts a 30 percent safe filler edit and rejects one above 35 percent', () => {
  const rawText = 'um uh erm delta epsilon zeta eta theta iota kappa';
  const prepared = prepareVoiceCleanup(rawText);

  const accepted = validateAndRestoreVoiceCleanup(
    prepared,
    'delta epsilon zeta eta theta iota kappa',
  );
  assert.equal(accepted.accepted, true);

  const tooManyFillers = 'um uh erm hmm epsilon zeta eta theta iota kappa';
  const rejected = validateAndRestoreVoiceCleanup(
    prepareVoiceCleanup(tooManyFillers),
    'epsilon zeta eta theta iota kappa',
  );
  assert.deepEqual(rejected, {
    accepted: false,
    reason: 'edit_ratio_exceeded',
    text: tooManyFillers,
  });
});

test('normalizes Unicode without altering accepted protected content', () => {
  const rawText = 'هرگز فایل «café.ts» نسخه ۱۲.۳ را پاک نکنید';
  const prepared = prepareVoiceCleanup(rawText);
  const candidate = prepared.maskedText.replace('فایل', 'فایل،');
  const result = validateAndRestoreVoiceCleanup(prepared, candidate);

  assert.equal(result.accepted, true);
  assert.equal(result.text, 'هرگز فایل، «café.ts» نسخه ۱۲.۳ را پاک نکنید');
});
