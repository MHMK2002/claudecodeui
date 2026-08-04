import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVoiceViewKey, isBackgroundVoiceOrigin } from './voiceOrigin';

test('distinguishes unsaved voice origins across projects and providers', () => {
  const first = buildVoiceViewKey(null, 'codex', 'project-a');
  const secondProject = buildVoiceViewKey(null, 'codex', 'project-b');
  const secondProvider = buildVoiceViewKey(null, 'claude', 'project-a');
  const secondUnsavedChat = buildVoiceViewKey(null, 'codex', 'project-a', 1);

  assert.notEqual(first, secondProject);
  assert.notEqual(first, secondProvider);
  assert.notEqual(first, secondUnsavedChat);
  assert.equal(isBackgroundVoiceOrigin(first, secondProject), true);
});

test('keeps a backend session identity stable across project/provider UI changes', () => {
  const before = buildVoiceViewKey('session-1', 'codex', 'project-a');
  const after = buildVoiceViewKey('session-1', 'claude', 'project-b');

  assert.equal(before, 'session:session-1');
  assert.equal(after, before);
  assert.equal(isBackgroundVoiceOrigin(before, after), false);
});
