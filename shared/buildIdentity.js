import fs from 'node:fs';

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const BUILD_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,159}$/;
const SYNTHETIC_IDENTITY_PATTERN = /(?:^|[._-])(unknown|unidentified|null|undefined)(?:$|[._-])/i;

/**
 * Validates the immutable version/build identifier shared by the client,
 * Electron, server, and packaged server archive. Consumers must reject an
 * invalid identity instead of manufacturing a local fallback, otherwise two
 * artifacts from different builds can appear compatible.
 *
 * @param {unknown} value Candidate identity object.
 * @param {{ expectedVersion?: string, source?: string }} [options]
 * @returns {{ version: string, buildId: string }} A normalized frozen identity.
 */
export function assertBuildIdentity(value, options = {}) {
  const source = options.source || 'Build identity';
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must be an object containing version and buildId.`);
  }

  const version = typeof value.version === 'string' ? value.version.trim() : '';
  const buildId = typeof value.buildId === 'string' ? value.buildId.trim() : '';

  if (!VERSION_PATTERN.test(version) || SYNTHETIC_IDENTITY_PATTERN.test(version)) {
    throw new Error(`${source} has an invalid or empty version.`);
  }
  if (!BUILD_ID_PATTERN.test(buildId) || SYNTHETIC_IDENTITY_PATTERN.test(buildId)) {
    throw new Error(`${source} has an invalid, empty, or synthetic buildId.`);
  }

  if (Object.prototype.hasOwnProperty.call(options, 'expectedVersion')) {
    const expectedVersion = typeof options.expectedVersion === 'string'
      ? options.expectedVersion.trim()
      : '';
    if (!VERSION_PATTERN.test(expectedVersion) || SYNTHETIC_IDENTITY_PATTERN.test(expectedVersion)) {
      throw new Error(`${source} expected package version is invalid or empty.`);
    }
    if (version !== expectedVersion) {
      throw new Error(`${source} version ${version} does not match package version ${expectedVersion}.`);
    }
  }

  return Object.freeze({ version, buildId });
}

/** Serializes a validated identity in the canonical artifact format. */
export function serializeBuildIdentity(value, options = {}) {
  return `${JSON.stringify(assertBuildIdentity(value, options), null, 2)}\n`;
}

/** Reads and validates a build identity for synchronous startup consumers. */
export function readBuildIdentityFileSync(filePath, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${options.source || 'Build identity'} could not be read from ${filePath}: ${error.message}`);
  }
  return assertBuildIdentity(parsed, options);
}

/** Reads and validates a build identity for build and packaging scripts. */
export async function readBuildIdentityFile(filePath, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${options.source || 'Build identity'} could not be read from ${filePath}: ${error.message}`);
  }
  return assertBuildIdentity(parsed, options);
}

/** Returns true only when both immutable identity fields are equal. */
export function buildIdentitiesMatch(left, right) {
  try {
    const a = assertBuildIdentity(left);
    const b = assertBuildIdentity(right);
    return a.version === b.version && a.buildId === b.buildId;
  } catch {
    return false;
  }
}
