import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyUpdateRelease } from '../../scripts/release/verify-update-release.mjs';

const VERSION = '1.38.0';

function sha512Base64(content) {
  return crypto.createHash('sha512').update(content).digest('base64');
}

function metadata(version, files) {
  const lines = [`version: ${version}`, 'files:'];
  for (const file of files) {
    lines.push(`  - url: ${file.name}`, `    sha512: ${sha512Base64(file.content)}`, `    size: ${file.content.length}`);
  }
  lines.push(`path: ${files[0].name}`, `sha512: ${sha512Base64(files[0].content)}`, 'releaseDate: 2026-08-16T00:00:00.000Z');
  return `${lines.join('\n')}\n`;
}

test('release verification checks all platforms, server bundles, sizes, and hashes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cloudcli-update-release-'));
  const assetsDir = path.join(root, 'assets');
  const metadataDir = path.join(root, 'metadata');
  await mkdir(assetsDir);
  await mkdir(metadataDir);

  const files = {
    macX64Zip: { name: `cloudcli-desktop-${VERSION}-mac-x64.zip`, content: Buffer.from('mac-x64-zip') },
    macArmZip: { name: `cloudcli-desktop-${VERSION}-mac-arm64.zip`, content: Buffer.from('mac-arm64-zip') },
    windows: { name: `cloudcli-desktop-${VERSION}-win-x64.exe`, content: Buffer.from('windows-exe') },
    linux: { name: `cloudcli-desktop-${VERSION}-linux-x86_64.AppImage`, content: Buffer.from('linux-appimage') },
  };

  try {
    for (const file of Object.values(files)) {
      await writeFile(path.join(assetsDir, file.name), file.content);
    }
    for (const artifactName of [
      `cloudcli-desktop-${VERSION}-mac-x64.dmg`,
      `cloudcli-desktop-${VERSION}-mac-arm64.dmg`,
    ]) {
      await writeFile(path.join(assetsDir, artifactName), 'dmg');
    }
    for (const bundleName of [
      `cloudcli-local-server-${VERSION}-mac-x64.tar.gz`,
      `cloudcli-local-server-${VERSION}-mac-arm64.tar.gz`,
      `cloudcli-local-server-${VERSION}-win-x64.tar.gz`,
      `cloudcli-local-server-${VERSION}-linux-x64.tar.gz`,
    ]) {
      await writeFile(path.join(assetsDir, bundleName), 'server');
      await writeFile(path.join(assetsDir, `${bundleName}.sha256`), 'checksum');
    }
    await writeFile(path.join(metadataDir, 'latest-mac.yml'), metadata(VERSION, [files.macX64Zip, files.macArmZip]));
    await writeFile(path.join(metadataDir, 'latest.yml'), metadata(VERSION, [files.windows]));
    await writeFile(path.join(metadataDir, 'latest-linux.yml'), metadata(VERSION, [files.linux]));

    assert.deepEqual(await verifyUpdateRelease({ assetsDir, metadataDir, version: VERSION }), {
      metadataFiles: 3,
      updaterArtifacts: 4,
    });

    await writeFile(path.join(assetsDir, files.windows.name), 'tampered');
    await assert.rejects(
      verifyUpdateRelease({ assetsDir, metadataDir, version: VERSION }),
      /size mismatch|sha512 mismatch/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
