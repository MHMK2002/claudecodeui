export const LOCAL_SESSION_COOKIE_NAME = 'cloudcli_session';
export const DESKTOP_SESSION_SECRET_HEADER = 'x-cloudcli-desktop-session-secret';
export const DESKTOP_SESSION_NONCE_HEADER = 'x-cloudcli-desktop-session-nonce';

/** One Desktop bootstrap/handoff challenge uses a 256-bit lowercase hex nonce. */
export function createDesktopSessionNonce(randomBytes) {
  return randomBytes(32).toString('hex');
}

/** Rejects malformed challenges before they reach the Desktop session broker. */
export function isDesktopSessionNonce(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
