import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('folder path display is not a duplicate mouse-only browser trigger', async () => {
  const source = await readFile(new URL('./WorkspacePathField.tsx', import.meta.url), 'utf8');
  const inputStart = source.indexOf('<Input');
  const inputEnd = source.indexOf('/>', inputStart);

  assert.notEqual(inputStart, -1);
  assert.notEqual(inputEnd, -1);
  assert.doesNotMatch(source.slice(inputStart, inputEnd), /onClick=/);
  assert.match(source, /aria-label={`Browse for \${label\.toLowerCase\(\)}`}/);
});
