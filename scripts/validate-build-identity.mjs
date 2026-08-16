#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIdentitiesMatch, readBuildIdentityFile } from '../shared/buildIdentity.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const canonicalPath = path.join(rootDir, '.build-identity', 'build-identity.json');
const distributionPath = path.join(rootDir, 'dist', 'build-identity.json');
const canonical = await readBuildIdentityFile(canonicalPath, {
  expectedVersion: packageJson.version,
  source: 'Canonical build identity',
});
const distribution = await readBuildIdentityFile(distributionPath, {
  expectedVersion: packageJson.version,
  source: 'Client distribution build identity',
});

if (!buildIdentitiesMatch(canonical, distribution)) {
  throw new Error('Client distribution identity differs from the canonical build identity.');
}
const [canonicalBytes, distributionBytes] = await Promise.all([
  fs.readFile(canonicalPath),
  fs.readFile(distributionPath),
]);
if (!canonicalBytes.equals(distributionBytes)) {
  throw new Error('Client distribution identity is not a byte-equivalent copy of the canonical artifact.');
}

const legacyBuildId = (await fs.readFile(path.join(rootDir, 'dist', 'build-id.txt'), 'utf8')).trim();
if (legacyBuildId !== canonical.buildId) {
  throw new Error('dist/build-id.txt differs from the canonical build identity.');
}

const serviceWorker = await fs.readFile(path.join(rootDir, 'dist', 'sw.js'), 'utf8');
const embeddedWorkerIdentity = `const EMBEDDED_BUILD_ID = ${JSON.stringify(canonical.buildId)};`;
if (!serviceWorker.includes(embeddedWorkerIdentity) || serviceWorker.includes('const EMBEDDED_BUILD_ID = null;')) {
  throw new Error('dist/sw.js does not embed the canonical build identity.');
}

console.log(`Validated build identity ${canonical.version} / ${canonical.buildId}.`);
