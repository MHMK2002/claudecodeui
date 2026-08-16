import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeUpdateMetadataDocuments } from '../../scripts/release/merge-update-metadata.mjs';

const X64_SHA = 'x'.repeat(88);
const ARM64_SHA = 'a'.repeat(88);

test('release metadata merges macOS architectures with deterministic selection', () => {
  const result = mergeUpdateMetadataDocuments([
    {
      version: '1.38.0',
      files: [{ url: 'cloudcli-desktop-1.38.0-mac-arm64.zip', sha512: ARM64_SHA, size: 20 }],
      path: 'cloudcli-desktop-1.38.0-mac-arm64.zip',
      sha512: ARM64_SHA,
      releaseDate: '2026-08-16T02:00:00.000Z',
    },
    {
      version: '1.38.0',
      files: [{ url: 'cloudcli-desktop-1.38.0-mac-x64.zip', sha512: X64_SHA, size: 21 }],
      path: 'cloudcli-desktop-1.38.0-mac-x64.zip',
      sha512: X64_SHA,
      releaseDate: '2026-08-16T01:00:00.000Z',
    },
  ], {
    version: '1.38.0',
    releaseDate: '2026-08-15T18:30:00.000Z',
  });

  assert.deepEqual(result.files.map((file) => file.url), [
    'cloudcli-desktop-1.38.0-mac-x64.zip',
    'cloudcli-desktop-1.38.0-mac-arm64.zip',
  ]);
  assert.equal(result.path, 'cloudcli-desktop-1.38.0-mac-x64.zip');
  assert.equal(result.sha512, X64_SHA);
  assert.equal(result.releaseDate, '2026-08-15T18:30:00.000Z');
});

test('release metadata rejects unversioned, conflicting, or mismatched assets', () => {
  assert.throws(
    () => mergeUpdateMetadataDocuments([{
      version: '1.38.0',
      files: [{ url: 'latest.zip', sha512: X64_SHA }],
    }], { version: '1.38.0', releaseDate: '2026-08-16T00:00:00.000Z' }),
    /not versioned/i,
  );
  assert.throws(
    () => mergeUpdateMetadataDocuments([{
      version: '1.39.0',
      files: [{ url: 'cloudcli-desktop-1.39.0-win-x64.exe', sha512: X64_SHA }],
    }], { version: '1.38.0', releaseDate: '2026-08-16T00:00:00.000Z' }),
    /version must equal/i,
  );
  assert.throws(
    () => mergeUpdateMetadataDocuments([
      { version: '1.38.0', files: [{ url: 'cloudcli-desktop-1.38.0-mac-x64.zip', sha512: X64_SHA }] },
      { version: '1.38.0', files: [{ url: 'cloudcli-desktop-1.38.0-mac-x64.zip', sha512: ARM64_SHA }] },
    ], { version: '1.38.0', releaseDate: '2026-08-16T00:00:00.000Z' }),
    /conflicting updater hashes/i,
  );
});
