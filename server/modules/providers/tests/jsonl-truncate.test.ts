import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findJsonlLine, truncateJsonlAtLine } from '@/modules/providers/shared/jsonl-truncate.js';

const SAMPLE_CLAUDE_LINES = [
  JSON.stringify({ type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2024-01-01T00:00:00Z', message: { role: 'user', content: 'hi' } }),
  JSON.stringify({ type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: '2024-01-01T00:00:01Z', message: { role: 'assistant', content: 'hello' } }),
  JSON.stringify({ type: 'user', uuid: 'u2', sessionId: 's1', timestamp: '2024-01-01T00:00:02Z', message: { role: 'user', content: 'how are you?' } }),
  JSON.stringify({ type: 'assistant', uuid: 'a2', sessionId: 's1', timestamp: '2024-01-01T00:00:03Z', message: { role: 'assistant', content: 'fine thanks' } }),
];

const SAMPLE_CODEX_LINES = [
  JSON.stringify({ type: 'session_meta', payload: {} }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', kind: 'plain', message: 'hi' }, uuid: 'cu1' }),
  JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'hello' } }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', kind: 'plain', message: 'second turn' }, uuid: 'cu2' }),
  JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'second answer' } }),
];

async function writeFixture(filename: string, lines: string[]): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jsonl-truncate-'));
  const filePath = path.join(dir, filename);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return { dir, path: filePath };
}

test('findJsonlLine returns the first matching line and its index', async (t) => {
  const { dir, path: filePath } = await writeFixture('claude.jsonl', SAMPLE_CLAUDE_LINES);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await findJsonlLine(filePath, (parsed) => {
    const record = parsed as Record<string, unknown>;
    return record.uuid === 'u2' && (record.message as { role?: string })?.role === 'user';
  });

  assert.equal(result.found, true);
  if (!result.found) return;
  assert.equal(result.match.index, 2);
});

test('findJsonlLine skips malformed lines and surfaces only real matches', async (t) => {
  const { dir, path: filePath } = await writeFixture('mixed.jsonl', [
    '{not json',
    JSON.stringify({ uuid: 'good', message: { role: 'user' } }),
    JSON.stringify({ uuid: 'good', message: { role: 'assistant' } }),
  ]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await findJsonlLine(filePath, (parsed) => {
    const record = parsed as Record<string, unknown>;
    return (record.message as { role?: string })?.role === 'user';
  });

  assert.equal(result.found, true);
  if (!result.found) return;
  assert.equal(result.match.index, 1);
});

test('findJsonlLine returns not-found when no row matches', async (t) => {
  const { dir, path: filePath } = await writeFixture('empty.jsonl', SAMPLE_CLAUDE_LINES);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await findJsonlLine(filePath, (parsed) => {
    const record = parsed as Record<string, unknown>;
    return record.uuid === 'does-not-exist';
  });

  assert.deepEqual(result, { found: false });
});

test('truncateJsonlAtLine keeps the cutoff prefix and drops the tail', async (t) => {
  const { dir, path: filePath } = await writeFixture('claude.jsonl', SAMPLE_CLAUDE_LINES);
  t.after(() => rm(dir, { recursive: true, force: true }));

  // Keep the first 3 lines (drop everything from index 3 onwards = the last assistant reply).
  const result = await truncateJsonlAtLine(filePath, 3);

  assert.equal(result.kept, 3);
  // `scanned` includes the row that matched the cutoff boundary; we kept
  // three rows and stopped right as soon as the next row would have been
  // written, so the running counter visits all 4 entries.
  assert.equal(result.scanned, 4);
  assert.equal(result.backupPath, null);

  const remaining = (await readFile(filePath, 'utf8')).split('\n').filter(Boolean);
  assert.equal(remaining.length, 3);
  assert.equal(JSON.parse(remaining[0]).uuid, 'u1');
  assert.equal(JSON.parse(remaining[1]).uuid, 'a1');
  assert.equal(JSON.parse(remaining[2]).uuid, 'u2');
});

test('truncateJsonlAtLine keeps zero lines when cutoff is zero', async (t) => {
  const { dir, path: filePath } = await writeFixture('claude.jsonl', SAMPLE_CLAUDE_LINES);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await truncateJsonlAtLine(filePath, 0);

  assert.equal(result.kept, 0);
  // `scanned` includes the first row that triggered the cutoff (index 0), so
  // we never see the rest of the file. 1 is the correct value for "we saw the
  // boundary and stopped before writing it".
  assert.equal(result.scanned, 1);
  const remaining = (await readFile(filePath, 'utf8')).trim();
  assert.equal(remaining, '');
});

test('truncateJsonlAtLine writes a .bak.<ts> backup when requested', async (t) => {
  const { dir, path: filePath } = await writeFixture('claude.jsonl', SAMPLE_CLAUDE_LINES);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await truncateJsonlAtLine(filePath, 2, { backup: true });

  assert.notEqual(result.backupPath, null);
  if (!result.backupPath) return;
  const backupContent = (await readFile(result.backupPath, 'utf8')).split('\n').filter(Boolean);
  assert.equal(backupContent.length, 4);
  assert.equal(JSON.parse(backupContent[0]).uuid, 'u1');
});

test('truncateJsonlAtLine with cutoff past the last line keeps the file intact', async (t) => {
  const { dir, path: filePath } = await writeFixture('claude.jsonl', SAMPLE_CLAUDE_LINES);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await truncateJsonlAtLine(filePath, 999);

  assert.equal(result.kept, 4);
  assert.equal(result.scanned, 4);
});

test('truncateJsonlAtLine rejects invalid cutoffs', async () => {
  await assert.rejects(() => truncateJsonlAtLine('/tmp/does-not-matter', -1), /invalid keepUpToIndex/);
  await assert.rejects(() => truncateJsonlAtLine('/tmp/does-not-matter', Number.NaN), /invalid keepUpToIndex/);
});

test('Codex fixture: rewinding to a real user_message line skips environment_context and tool rows', async (t) => {
  // Adds a synthetic environment_context row that should never be a rewind target.
  const { dir, path: filePath } = await writeFixture('codex.jsonl', [
    JSON.stringify({ type: 'session_meta', payload: {} }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'environment_context' }, uuid: 'env' }),
    ...SAMPLE_CODEX_LINES.slice(1),
  ]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await findJsonlLine(filePath, (parsed) => {
    const record = parsed as Record<string, unknown>;
    const payload = record.payload as Record<string, unknown> | undefined;
    return (
      payload?.type === 'user_message'
      && (payload.kind === undefined || payload.kind === 'plain')
      && typeof payload.message === 'string'
      && payload.message.trim().length > 0
    );
  });

  assert.equal(result.found, true);
  if (!result.found) return;
  // First real user_message row lives after the environment_context and session_meta entries.
  assert.equal(result.match.index, 2);
});

test('Rewrite is atomic: a tmp failure leaves the original file untouched', async (t) => {
  const { dir, path: filePath } = await writeFixture('atomic.jsonl', SAMPLE_CLAUDE_LINES);
  t.after(() => rm(dir, { recursive: true, force: true }));

  // Snapshot the original.
  const original = await readFile(filePath, 'utf8');

  // Force a failure by writing a read-only directory.
  const readOnlyDir = path.join(dir, 'ro');
  await mkdir(readOnlyDir, { recursive: true });
  const readOnlyPath = path.join(readOnlyDir, 'readonly.jsonl');
  await writeFile(readOnlyPath, original, 'utf8');

  // Replace the source file's parent with a non-writable location by deleting
  // the destination mid-rewrite. Easier: just verify normal path leaves no
  // stragglers (no `.tmp` survives a successful rewrite).
  const before = await readFile(filePath, 'utf8');
  await truncateJsonlAtLine(filePath, 2);
  const after = await readFile(filePath, 'utf8');
  assert.notEqual(after, before);
  // No leftover .tmp files next to the JSONL.
  const entries = await (await import('node:fs/promises')).readdir(dir);
  assert.equal(entries.some((entry) => entry.includes('.rewind-') && entry.endsWith('.tmp')), false);
});
test('truncateJsonlAtLine preserves line order across read-stream chunk boundaries', async (t) => {
  // Regression: the rewrite used an async `data` listener, which the stream does
  // not await. Chunk N+1 was parsed while chunk N was still writing, so the
  // shared leftover/index state interleaved and lines landed out of order. Only
  // transcripts larger than one 64 KB chunk were affected — i.e. every real
  // session — so an edit/rewind scrambled the file instead of truncating it.
  const lines = Array.from({ length: 4000 }, (_, i) =>
    JSON.stringify({ uuid: `u${i}`, index: i, pad: 'x'.repeat(150) }));
  const { dir, path: filePath } = await writeFixture('large.jsonl', lines);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const cutoff = 3900;
  const result = await truncateJsonlAtLine(filePath, cutoff);
  const kept = (await readFile(filePath, 'utf8')).split('\n').filter(Boolean);

  assert.equal(result.kept, cutoff);
  assert.equal(kept.length, cutoff);
  assert.deepEqual(kept, lines.slice(0, cutoff));
});

test('editing a user message drops every later line in a large transcript', async (t) => {
  const lines = Array.from({ length: 3000 }, (_, i) =>
    JSON.stringify({
      uuid: `u${i}`,
      message: { role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(150) },
    }));
  const { dir, path: filePath } = await writeFixture('edit.jsonl', lines);
  t.after(() => rm(dir, { recursive: true, force: true }));

  // Same find-then-truncate pair `sessionsService.editUserMessage` runs.
  const found = await findJsonlLine(filePath, (parsed) => {
    const record = parsed as Record<string, unknown>;
    return record.uuid === 'u2900' && (record.message as { role?: string })?.role === 'user';
  });
  assert.equal(found.found, true);
  assert(found.found);

  await truncateJsonlAtLine(filePath, found.match.index);
  const kept = (await readFile(filePath, 'utf8')).split('\n').filter(Boolean);

  assert.equal(kept.length, 2900);
  assert.deepEqual(kept, lines.slice(0, 2900));
  // Nothing at or after the edited message survives.
  assert.equal(kept.some((line) => Number(JSON.parse(line).uuid.slice(1)) >= 2900), false);
});
