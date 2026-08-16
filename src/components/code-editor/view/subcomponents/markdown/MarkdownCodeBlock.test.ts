import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('code block Copy is visible on focus with a named 44px target', async () => {
  const source = await readFile(new URL('./MarkdownCodeBlock.tsx', import.meta.url), 'utf8');
  const buttonStart = source.indexOf('<button');
  const buttonEnd = source.indexOf('</button>', buttonStart);
  const buttonSource = source.slice(buttonStart, buttonEnd);

  assert.notEqual(buttonStart, -1);
  assert.notEqual(buttonEnd, -1);
  assert.match(buttonSource, /min-h-11/);
  assert.match(buttonSource, /min-w-11/);
  assert.match(buttonSource, /focus-visible:opacity-100/);
  assert.match(buttonSource, /focus-visible:ring-2/);
  assert.match(buttonSource, /Copy/);
});
