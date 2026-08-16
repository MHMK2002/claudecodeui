import type { VerifyClientCallbackSync } from 'ws';

import type {
  AuthenticatedWebSocketRequest,
  AuthenticatedWebSocketUser,
  RuntimeMode,
} from '@/shared/types.js';
import { isBrowserOriginAllowed, isLoopbackNetworkAddress } from '@/shared/utils.js';

type WebSocketAuthDependencies = {
  runtimeMode: RuntimeMode;
  allowedDesktopOrigin?: string;
  authenticateWebSocket: (credentials: {
    cookieHeader?: string | string[];
    authorizationHeader?: string | string[];
  }) => AuthenticatedWebSocketUser | null;
};

/**
 * Authenticates websocket upgrades from the shared HttpOnly session cookie.
 * JWT/query credentials are rejected before route dispatch so secrets never
 * enter URLs, proxy logs, history, or diagnostics.
 */
export function verifyWebSocketClient(
  info: Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0],
  dependencies: WebSocketAuthDependencies,
): boolean {
  const request = info.req as AuthenticatedWebSocketRequest;
  const upgradeUrl = new URL(request.url ?? '/', 'http://localhost');
  console.log('WebSocket connection attempt to:', upgradeUrl.pathname);

  if (upgradeUrl.searchParams.has('token') || upgradeUrl.searchParams.has('access_token')) {
    console.warn('[WARN] WebSocket query credentials are not accepted');
    return false;
  }

  if (
    dependencies.runtimeMode === 'desktop-local'
    && !isBrowserOriginAllowed({
      origin: info.origin,
      requestHost: request.headers.host,
      secure: info.secure,
      allowedOrigin: dependencies.allowedDesktopOrigin,
      loopbackOnly: true,
    })
  ) {
    console.warn('[WARN] Desktop local WebSocket origin does not match the app origin');
    return false;
  }

  if (
    (upgradeUrl.pathname === '/shell' || upgradeUrl.pathname === '/command-terminal')
    && (
      dependencies.runtimeMode === 'desktop-lan'
      || dependencies.runtimeMode === 'platform'
      || !isLoopbackNetworkAddress(request.socket.remoteAddress)
      || !isBrowserOriginAllowed({
        origin: info.origin,
        requestHost: request.headers.host,
        secure: info.secure,
        allowedOrigin: dependencies.runtimeMode === 'desktop-local'
          ? dependencies.allowedDesktopOrigin
          : undefined,
        loopbackOnly: true,
      })
    )
  ) {
    console.warn('[WARN] Shell WebSocket is disabled outside a loopback local runtime');
    return false;
  }

  const user = dependencies.authenticateWebSocket({
    cookieHeader: request.headers.cookie,
    authorizationHeader: request.headers.authorization,
  });
  if (!user) {
    console.warn('[WARN] WebSocket authentication failed');
    return false;
  }

  request.user = user;
  console.log('[OK] WebSocket authenticated for user:', user.username);
  return true;
}
