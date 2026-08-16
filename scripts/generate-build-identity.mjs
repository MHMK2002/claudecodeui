#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertBuildIdentity,
  readBuildIdentityFile,
  serializeBuildIdentity,
} from '../shared/buildIdentity.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.join(rootDir, '.build-identity');
const artifactPath = path.join(artifactDir, 'build-identity.json');
const lockPath = path.join(artifactDir, '.generation-lock');
const lockOwnerPath = path.join(lockPath, 'owner.json');
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 10_000;
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const version = typeof packageJson.version === 'string' ? packageJson.version.trim() : '';
const force = process.argv.includes('--force');

function createIdentity() {
  const hasConfiguredId = Object.prototype.hasOwnProperty.call(process.env, 'CLOUDCLI_BUILD_ID');
  const configuredId = hasConfiguredId ? String(process.env.CLOUDCLI_BUILD_ID).trim() : null;
  if (hasConfiguredId && !configuredId) {
    throw new Error('CLOUDCLI_BUILD_ID was provided but is empty.');
  }
  return assertBuildIdentity({
    version,
    buildId: configuredId || `${version}-${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}`,
  }, { expectedVersion: version, source: 'Generated build identity' });
}

async function readExisting() {
  try {
    await fs.access(artifactPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  const identity = await readBuildIdentityFile(artifactPath, {
    expectedVersion: version,
    source: 'Canonical build identity',
  });
  const configuredId = process.env.CLOUDCLI_BUILD_ID?.trim();
  if (configuredId && identity.buildId !== configuredId) {
    throw new Error('CLOUDCLI_BUILD_ID differs from the existing canonical build identity.');
  }
  return identity;
}

await fs.mkdir(artifactDir, { recursive: true });
const lockOwnerToken = `${process.pid}-${crypto.randomBytes(16).toString('hex')}`;
let lockDeadline = Date.now() + LOCK_WAIT_MS;
while (true) {
  try {
    await fs.mkdir(lockPath);
    try {
      await fs.writeFile(
        lockOwnerPath,
        `${JSON.stringify({ token: lockOwnerToken, pid: process.pid })}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
    } catch (error) {
      await fs.rm(lockPath, { recursive: true, force: true });
      throw error;
    }
    break;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const lockStats = await fs.stat(lockPath).catch((statError) => {
      if (statError?.code === 'ENOENT') return null;
      throw statError;
    });
    if (!lockStats) {
      lockDeadline = Date.now() + LOCK_WAIT_MS;
      continue;
    }
    if (Date.now() - lockStats.mtimeMs >= LOCK_STALE_MS) {
      const stalePath = `${lockPath}.stale-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
      try {
        await fs.rename(lockPath, stalePath);
        await fs.rm(stalePath, { recursive: true, force: true });
      } catch (takeoverError) {
        if (takeoverError?.code !== 'ENOENT') throw takeoverError;
      }
      // Every contender gets a fresh wait window after a stale takeover race;
      // only the process that owns the atomic mkdir proceeds into generation.
      lockDeadline = Date.now() + LOCK_WAIT_MS;
      continue;
    }
    if (Date.now() >= lockDeadline) {
      throw new Error('Timed out waiting for the build identity generation lock.');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

let existing;
let identity;
try {
  existing = force ? null : await readExisting();
  identity = existing || createIdentity();

  if (!existing) {
    const temporaryPath = `${artifactPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(temporaryPath, serializeBuildIdentity(identity), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, artifactPath);
  }
} finally {
  try {
    const owner = JSON.parse(await fs.readFile(lockOwnerPath, 'utf8'));
    if (owner?.token === lockOwnerToken) {
      await fs.rm(lockPath, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

console.log(`${existing ? 'Using' : 'Generated'} build identity ${identity.version} / ${identity.buildId}`);
