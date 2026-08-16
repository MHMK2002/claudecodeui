import assert from 'node:assert/strict';
import test from 'node:test';

import { createCodeEditorDocumentGuard } from './codeEditorDocumentGuard';

test('a late load cannot commit after the selected document changes', () => {
  const guard = createCodeEditorDocumentGuard();
  const fileALoad = guard.beginDocumentLoad('project-1:file-a');
  const fileBLoad = guard.beginDocumentLoad('project-1:file-b');

  assert.equal(guard.canCommitLoad(fileALoad), false);
  assert.equal(guard.canCommitLoad(fileBLoad), true);
});

test('a completed save is not marked current after the buffer changes', () => {
  const guard = createCodeEditorDocumentGuard();
  const load = guard.beginDocumentLoad('project-1:file-a');
  assert.equal(guard.canCommitLoad(load), true);

  const save = guard.beginDocumentSave('project-1:file-a');
  guard.noteContentChange('project-1:file-a');

  assert.equal(guard.canCommitSave(save), false);
});

test('a save from the previous document cannot update the new document state', () => {
  const guard = createCodeEditorDocumentGuard();
  guard.beginDocumentLoad('project-1:file-a');
  const fileASave = guard.beginDocumentSave('project-1:file-a');
  guard.beginDocumentLoad('project-1:file-b');

  assert.equal(guard.canCommitSave(fileASave), false);
});
