#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readBuildIdentityFile } from '../shared/buildIdentity.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const sourcePath = path.join(rootDir, '.build-identity', 'build-identity.json');
const destinationPath = path.join(rootDir, 'dist-server', 'build-identity.json');

await readBuildIdentityFile(sourcePath, {
  expectedVersion: packageJson.version,
  source: 'Canonical compiled-server identity',
});
await fs.mkdir(path.dirname(destinationPath), { recursive: true });
await fs.copyFile(sourcePath, destinationPath);
const [sourceBytes, destinationBytes] = await Promise.all([
  fs.readFile(sourcePath),
  fs.readFile(destinationPath),
]);
if (!sourceBytes.equals(destinationBytes)) {
  throw new Error('Compiled server identity is not a byte-equivalent canonical artifact.');
}

console.log(`Embedded compiled server identity at ${path.relative(rootDir, destinationPath)}.`);
