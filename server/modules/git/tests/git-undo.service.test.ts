import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createGitUndoService } from '@/modules/git/git-undo.service.js';

test('temporary Git snapshot restores a discarded file only for its project owner', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'git-undo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'src', 'file.txt');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, 'before discard', 'utf8');
  const service = createGitUndoService({ stat, readFile, writeFile, mkdir, rm });

  const token = await service.capture({
    projectId: 'project-1',
    repositoryRoot: root,
    relativePath: 'src/file.txt',
  });
  assert.ok(token);
  await writeFile(filePath, 'restored by Git', 'utf8');
  assert.equal(await service.restore('other-project', token), 'missing');
  assert.equal(await service.restore('project-1', token), 'restored');
  assert.equal(await readFile(filePath, 'utf8'), 'before discard');
  assert.equal(await service.restore('project-1', token), 'missing');
});

test('undo of a deleted working-tree state removes the file recreated by Git restore', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'git-undo-delete-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'deleted.txt');
  const service = createGitUndoService({ stat, readFile, writeFile, mkdir, rm });
  const token = await service.capture({
    projectId: 'project-1',
    repositoryRoot: root,
    relativePath: 'deleted.txt',
    currentlyMissing: true,
  });
  assert.ok(token);
  await writeFile(filePath, 'HEAD content', 'utf8');
  assert.equal(await service.restore('project-1', token), 'restored');
  await assert.rejects(() => stat(filePath), { code: 'ENOENT' });
});
