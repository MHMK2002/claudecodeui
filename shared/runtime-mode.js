import { isLoopbackHost, isWildcardHost } from './networkHosts.js';

export const RUNTIME_MODES = Object.freeze([
  'desktop-local',
  'desktop-lan',
  'standalone-web',
  'platform',
]);

const RUNTIME_MODE_SET = new Set(RUNTIME_MODES);

/** Validates one of the four product runtime boundaries without inventing a fallback. */
export function assertRuntimeMode(value, source = 'Runtime mode') {
  if (typeof value !== 'string' || !RUNTIME_MODE_SET.has(value)) {
    throw new Error(`${source} must be one of: ${RUNTIME_MODES.join(', ')}.`);
  }
  return value;
}

/**
 * Resolves the server mode from explicit Desktop/platform ownership or the standalone default.
 * @param {{ configuredMode?: string, isPlatform?: boolean, desktopManaged?: boolean }} [options]
 */
export function resolveRuntimeMode({
  configuredMode = undefined,
  isPlatform = false,
  desktopManaged = false,
} = {}) {
  const mode = configuredMode
    ? assertRuntimeMode(configuredMode, 'Configured runtime mode')
    : isPlatform
      ? 'platform'
      : 'standalone-web';

  if (mode === 'platform' && !isPlatform) {
    throw new Error('Platform runtime mode requires the hosted platform feature boundary.');
  }
  if ((mode === 'desktop-local' || mode === 'desktop-lan') && !desktopManaged) {
    throw new Error(`${mode} requires an app-managed Desktop process.`);
  }
  if (isPlatform && mode !== 'platform') {
    throw new Error('Hosted platform configuration must use platform runtime mode.');
  }
  return mode;
}

/** Rejects a Desktop mode whose network bind would cross its declared boundary. */
export function validateRuntimeModeHost(modeValue, host) {
  const mode = assertRuntimeMode(modeValue);
  if (mode === 'desktop-local' && !isLoopbackHost(host)) {
    throw new Error('desktop-local must bind to a loopback host.');
  }
  if (mode === 'desktop-lan' && (isLoopbackHost(host) || !host)) {
    throw new Error('desktop-lan requires an explicit non-loopback bind and authentication.');
  }
  if (mode === 'desktop-lan' && !isWildcardHost(host) && /\s/.test(host)) {
    throw new Error('desktop-lan bind host is invalid.');
  }
  return host;
}

export function usesPasswordlessDesktopSession(modeValue) {
  return assertRuntimeMode(modeValue) === 'desktop-local';
}
