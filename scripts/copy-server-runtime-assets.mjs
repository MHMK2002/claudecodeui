#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeAssets = ['shared/session-export-contract.js'];

for (const relativePath of runtimeAssets) {
  const sourcePath = path.join(rootDirectory, relativePath);
  const destinationPath = path.join(rootDirectory, 'dist-server', relativePath);
  const sourceBytes = await fs.readFile(sourcePath);
  if (sourceBytes.length === 0) {
    throw new Error(`Server runtime asset is empty: ${relativePath}`);
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
  const destinationBytes = await fs.readFile(destinationPath);
  if (!sourceBytes.equals(destinationBytes)) {
    throw new Error(`Server runtime asset copy is not byte-equivalent: ${relativePath}`);
  }
}

console.log(`Copied ${runtimeAssets.length} server runtime asset.`);
