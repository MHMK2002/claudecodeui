#!/usr/bin/env node
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const updaterRequire = createRequire(path.join(rootDir, 'node_modules', 'electron-updater', 'package.json'));
const yaml = updaterRequire('js-yaml');

function sha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
    stream.on('error', reject);
  });
}

function assertSafeAssetName(assetName, version) {
  if (typeof assetName !== 'string' || assetName !== path.basename(assetName) || assetName.includes('..')) {
    throw new Error(`Unsafe release asset name: ${assetName}`);
  }
  if (!assetName.includes(version)) {
    throw new Error(`Release asset is not versioned for ${version}: ${assetName}`);
  }
}

export async function verifyUpdateRelease({ assetsDir, metadataDir, version }) {
  const metadataNames = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];
  const metadata = new Map();
  for (const metadataName of metadataNames) {
    const document = yaml.load(await fs.readFile(path.join(metadataDir, metadataName), 'utf8'));
    if (!document || document.version !== version || !Array.isArray(document.files) || document.files.length === 0) {
      throw new Error(`${metadataName} does not describe version ${version}.`);
    }
    metadata.set(metadataName, document);

    for (const file of document.files) {
      assertSafeAssetName(file?.url, version);
      const artifactPath = path.join(assetsDir, file.url);
      const stats = await fs.stat(artifactPath);
      if (!stats.isFile()) throw new Error(`Updater artifact is not a regular file: ${file.url}`);
      if (file.size != null && Number(file.size) !== stats.size) {
        throw new Error(`Updater artifact size mismatch: ${file.url}`);
      }
      if (await sha512Base64(artifactPath) !== file.sha512) {
        throw new Error(`Updater artifact sha512 mismatch: ${file.url}`);
      }
    }
  }

  const macUrls = metadata.get('latest-mac.yml').files.map((file) => file.url);
  if (!macUrls.some((name) => name.endsWith('-mac-x64.zip'))
    || !macUrls.some((name) => name.endsWith('-mac-arm64.zip'))) {
    throw new Error('macOS metadata must include both x64 and arm64 ZIP updates.');
  }
  if (!metadata.get('latest.yml').files.some((file) => file.url.endsWith('-win-x64.exe'))) {
    throw new Error('Windows metadata must include the signed x64 NSIS installer.');
  }
  if (!metadata.get('latest-linux.yml').files.some((file) => file.url.endsWith('-linux-x64.AppImage'))) {
    throw new Error('Linux metadata must include the x64 AppImage.');
  }

  const assetNames = await fs.readdir(assetsDir);
  for (const expectedSuffix of [
    '-mac-x64.dmg',
    '-mac-arm64.dmg',
    '-win-x64.exe',
    '-linux-x64.AppImage',
  ]) {
    if (!assetNames.some((name) => name === `cloudcli-desktop-${version}${expectedSuffix}`)) {
      throw new Error(`Required desktop release artifact is missing: *${expectedSuffix}`);
    }
  }
  for (const expectedBundle of [
    `cloudcli-local-server-${version}-mac-x64.tar.gz`,
    `cloudcli-local-server-${version}-mac-arm64.tar.gz`,
    `cloudcli-local-server-${version}-win-x64.tar.gz`,
    `cloudcli-local-server-${version}-linux-x64.tar.gz`,
  ]) {
    if (!assetNames.includes(expectedBundle) || !assetNames.includes(`${expectedBundle}.sha256`)) {
      throw new Error(`Required local server release artifact is missing: ${expectedBundle}`);
    }
  }

  return {
    metadataFiles: metadataNames.length,
    updaterArtifacts: new Set(
      Array.from(metadata.values()).flatMap((document) => document.files.map((file) => file.url)),
    ).size,
  };
}

const [assetsDir, metadataDir, version] = process.argv.slice(2);
if (assetsDir && metadataDir && version) {
  const result = await verifyUpdateRelease({ assetsDir, metadataDir, version });
  console.log(`Verified ${result.metadataFiles} metadata files and ${result.updaterArtifacts} updater artifacts.`);
}
