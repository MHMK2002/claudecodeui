import fs from 'node:fs';
import path from 'node:path';

import { readBuildIdentityFileSync } from '../../../shared/buildIdentity.js';

type ServerBuildIdentity = Readonly<{
  version: string;
  buildId: string;
}>;

type LoadServerBuildIdentityOptions = {
  appRoot: string;
  runtimeLayout: 'source' | 'compiled';
};

function readPackageVersion(appRoot: string): string {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Server package version could not be read: ${message}`);
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Server package version is empty.');
  }
  return value.trim();
}

/**
 * Loads the immutable build identity consumed by the server entrypoint. Git
 * development runs use the canonical build-start artifact. Compiled and
 * archived runtimes use the immutable artifact embedded in `dist-server`,
 * even when they happen to execute from inside a git checkout.
 */
export function loadServerBuildIdentity(
  options: LoadServerBuildIdentityOptions,
): ServerBuildIdentity {
  const expectedVersion = readPackageVersion(options.appRoot);
  const identityPath = options.runtimeLayout === 'source'
    ? path.join(options.appRoot, '.build-identity', 'build-identity.json')
    : path.join(options.appRoot, 'dist-server', 'build-identity.json');

  if (!fs.existsSync(identityPath)) {
    throw new Error(`Server build identity is missing. Checked: ${identityPath}`);
  }

  return readBuildIdentityFileSync(identityPath, {
    expectedVersion,
    source: 'Server build identity',
  });
}
