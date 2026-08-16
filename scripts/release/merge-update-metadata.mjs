#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const updaterRequire = createRequire(path.join(rootDir, 'node_modules', 'electron-updater', 'package.json'));
const yaml = updaterRequire('js-yaml');

function assertVersionedAssetName(assetName, version) {
  if (typeof assetName !== 'string' || !assetName.includes(version)) {
    throw new Error(`Update metadata asset is not versioned for ${version}: ${assetName}`);
  }
  if (assetName !== path.basename(assetName) || assetName.includes('..')) {
    throw new Error(`Update metadata contains an unsafe asset name: ${assetName}`);
  }
}

export function mergeUpdateMetadataDocuments(documents, { version, releaseDate }) {
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error('At least one updater metadata document is required.');
  }

  const filesByUrl = new Map();
  for (const document of documents) {
    if (!document || typeof document !== 'object' || document.version !== version) {
      throw new Error(`Updater metadata version must equal ${version}.`);
    }
    if (!Array.isArray(document.files) || document.files.length === 0) {
      throw new Error('Updater metadata must contain at least one file.');
    }
    for (const file of document.files) {
      assertVersionedAssetName(file?.url, version);
      if (typeof file.sha512 !== 'string' || file.sha512.length < 40) {
        throw new Error(`Updater metadata is missing sha512 for ${file?.url || 'unknown asset'}.`);
      }
      const existing = filesByUrl.get(file.url);
      if (existing && existing.sha512 !== file.sha512) {
        throw new Error(`Conflicting updater hashes for ${file.url}.`);
      }
      filesByUrl.set(file.url, { ...file });
    }
  }

  const files = Array.from(filesByUrl.values()).sort((first, second) => {
    const firstArm = first.url.includes('arm64') ? 1 : 0;
    const secondArm = second.url.includes('arm64') ? 1 : 0;
    return firstArm - secondArm || first.url.localeCompare(second.url);
  });
  const preferredFile = files.find((file) => !file.url.includes('arm64')) || files[0];
  const merged = {
    ...documents[0],
    version,
    files,
    path: preferredFile.url,
    sha512: preferredFile.sha512,
    releaseDate,
  };
  delete merged.stagingPercentage;
  return merged;
}

function parseArguments(argv) {
  const argumentsCopy = [...argv];
  const result = { inputs: [] };
  while (argumentsCopy.length > 0) {
    const value = argumentsCopy.shift();
    if (value === '--output') result.output = argumentsCopy.shift();
    else if (value === '--version') result.version = argumentsCopy.shift();
    else if (value === '--release-date') result.releaseDate = argumentsCopy.shift();
    else result.inputs.push(value);
  }
  if (!result.output || !result.version || !result.releaseDate || result.inputs.length === 0) {
    throw new Error('Usage: merge-update-metadata --output <file> --version <version> --release-date <ISO date> <input...>');
  }
  if (Number.isNaN(Date.parse(result.releaseDate))) {
    throw new Error('Updater metadata release date must be an ISO date.');
  }
  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const documents = await Promise.all(options.inputs.map(async (inputPath) => yaml.load(
    await fs.readFile(inputPath, 'utf8'),
  )));
  const merged = mergeUpdateMetadataDocuments(documents, options);
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, yaml.dump(merged, { lineWidth: 160, noRefs: true }), 'utf8');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
