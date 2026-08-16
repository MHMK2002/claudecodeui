import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchFileTreeData, FileTreeLoadError } from './useFileTreeData.js';

test('file loading returns an empty success only for a successful empty response', async () => {
  const files = await fetchFileTreeData('project-1', undefined, async () => new Response('[]', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));

  assert.deepEqual(files, []);
});

test('permission failure is structurally distinct from an empty folder', async () => {
  await assert.rejects(
    () => fetchFileTreeData('project-1', undefined, async () => new Response(
      JSON.stringify({ error: 'Permission denied' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )),
    (error: unknown) => {
      assert.ok(error instanceof FileTreeLoadError);
      assert.equal(error.kind, 'permission');
      assert.equal(error.status, 403);
      return true;
    },
  );
});

test('server or invalid-content failure is structurally distinct from an empty folder', async () => {
  await assert.rejects(
    () => fetchFileTreeData('project-1', undefined, async () => new Response(
      '<html>server failed</html>',
      { status: 500, headers: { 'content-type': 'text/html' } },
    )),
    (error: unknown) => {
      assert.ok(error instanceof FileTreeLoadError);
      assert.equal(error.kind, 'server');
      assert.equal(error.status, 500);
      assert.doesNotMatch(error.message, /Unexpected token/);
      return true;
    },
  );
});
