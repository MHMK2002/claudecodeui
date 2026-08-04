import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('synthetic voice cleanup corpus produces an aggregate-only report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-cleanup-benchmark-'));
  const output = join(directory, 'report.json');
  try {
    const run = spawnSync(
      process.execPath,
      [
        resolve('scripts/voice-cleanup-benchmark.mjs'),
        '--manifest',
        resolve('benchmarks/voice-cleanup/synthetic/manifest.jsonl'),
        '--output',
        output,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);

    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.sampleCount, 2);
    assert.equal(report.privacy.aggregateOnly, true);
    assert.deepEqual(Object.keys(report.variants), [
      'cleanup-gated',
      'contextual-stt',
      'raw',
    ]);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('synthetic-fa-en-001'), false);
    assert.equal(serialized.includes('useVoiceInput'), false);
    assert.equal(serialized.includes('src/lib/voiceApi.ts'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects arbitrary variant labels before they can enter an aggregate report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-cleanup-benchmark-label-'));
  const manifest = join(directory, 'manifest.jsonl');
  const raw = join(directory, 'raw.txt');
  const candidate = join(directory, 'candidate.txt');
  const output = join(directory, 'report.json');
  try {
    await writeFile(raw, 'raw transcript', 'utf8');
    await writeFile(candidate, 'candidate transcript', 'utf8');
    await writeFile(
      manifest,
      `${JSON.stringify({
        id: 'private-sample-id',
        raw,
        results: [{ variant: 'private-sample-id', transcript: candidate }],
      })}\n`,
      'utf8',
    );

    const run = spawnSync(
      process.execPath,
      [resolve('scripts/voice-cleanup-benchmark.mjs'), '--manifest', manifest, '--output', output],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 2);
    assert.equal(run.stderr.includes('private-sample-id'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
