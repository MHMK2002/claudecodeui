import crypto from 'node:crypto';

import { isLoopbackNetworkAddress, secureStringsMatch } from '@/shared/utils.js';

/** Used by the server entrypoint to expose a non-secret ownership proof in health metadata. */
export function getDesktopOwnerProof(ownerNonce: string | undefined): string | null {
  if (!ownerNonce) return null;
  return crypto.createHash('sha256').update(ownerNonce).digest('hex');
}

/** Used by the server entrypoint to authorize a loopback-only Desktop shutdown challenge. */
export function isDesktopShutdownAuthorized(options: {
  remoteAddress: string | undefined;
  providedOwnerNonce: string | undefined;
  expectedOwnerNonce: string | undefined;
}): boolean {
  return isLoopbackNetworkAddress(options.remoteAddress)
    && Boolean(options.providedOwnerNonce)
    && Boolean(options.expectedOwnerNonce)
    && secureStringsMatch(options.providedOwnerNonce ?? '', options.expectedOwnerNonce ?? '');
}

/** Used by the server entrypoint to schedule its shared cross-platform graceful shutdown callback. */
export function scheduleDesktopRuntimeShutdown(shutdown: () => void): void {
  const timer = setTimeout(shutdown, 25);
  timer.unref();
}
