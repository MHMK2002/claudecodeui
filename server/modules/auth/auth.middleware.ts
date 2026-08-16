import { createRequire } from 'node:module';

import type { Request, RequestHandler } from 'express';

import { appConfigDb, userDb } from '@/modules/database/index.js';
import type { AuthenticatedWebSocketUser, RuntimeMode } from '@/shared/types.js';
import {
  RUNTIME_MODE,
  SESSION_COOKIE_NAME,
  isBrowserOriginAllowed,
  readCookieValue,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from '@/shared/utils.js';

type AuthUser = {
  id: number | bigint;
  username: string;
  [key: string]: unknown;
};

type TokenPayload = {
  exp?: number;
  iat?: number;
  userId?: unknown;
  username?: unknown;
  [key: string]: unknown;
};

type JwtAdapter = {
  sign(
    payload: Record<string, unknown>,
    secret: string,
    options: { expiresIn: string },
  ): string;
  verify(token: string, secret: string): string | TokenPayload;
  TokenExpiredError: new (...args: never[]) => Error;
};

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken') as JwtAdapter;

type AuthenticationRequest = Request & { user?: AuthUser };

type AuthBoundaryDependencies = {
  runtimeMode: RuntimeMode;
  jwtSecret: string;
  allowedDesktopOrigin?: string;
  users: {
    getFirstUser(): AuthUser | undefined;
    getUserById(userId: number): AuthUser | undefined;
  };
};

type WebSocketCredentials = {
  cookieHeader?: string | string[];
  authorizationHeader?: string | string[];
};

function readBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

function readUserId(payload: string | TokenPayload): number | null {
  if (typeof payload === 'string') return null;
  const rawUserId = (payload as TokenPayload).userId;
  const userId = typeof rawUserId === 'number'
    ? rawUserId
    : typeof rawUserId === 'string' && /^\d+$/.test(rawUserId)
      ? Number(rawUserId)
      : NaN;
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

/**
 * Creates the mode-aware REST/WebSocket authentication boundary. Auth module
 * tests inject an isolated user store; the production instance below injects
 * the Database module and the installation-specific JWT secret.
 */
export function createAuthBoundary(dependencies: AuthBoundaryDependencies) {
  const generateSessionToken = (user: AuthUser): string => jwt.sign(
    {
      userId: Number(user.id),
      username: user.username,
    },
    dependencies.jwtSecret,
    { expiresIn: '7d' },
  );

  const resolveToken = (credentials: WebSocketCredentials): {
    token: string | null;
    source: 'cookie' | 'bearer' | null;
  } => {
    if (dependencies.runtimeMode === 'desktop-local') {
      const cookieToken = readCookieValue(credentials.cookieHeader, SESSION_COOKIE_NAME);
      return cookieToken
        ? { token: cookieToken, source: 'cookie' }
        : { token: null, source: null };
    }
    const bearerToken = readBearerToken(credentials.authorizationHeader);
    if (bearerToken) return { token: bearerToken, source: 'bearer' };
    const cookieToken = readCookieValue(credentials.cookieHeader, SESSION_COOKIE_NAME);
    return cookieToken
      ? { token: cookieToken, source: 'cookie' }
      : { token: null, source: null };
  };

  const verifySessionToken = (token: string): { user: AuthUser; payload: TokenPayload } | null => {
    const payload = jwt.verify(token, dependencies.jwtSecret);
    const userId = readUserId(payload);
    if (userId === null) return null;
    const user = dependencies.users.getUserById(userId);
    return user && typeof payload !== 'string'
      ? { user, payload: payload as TokenPayload }
      : null;
  };

  const authenticateToken: RequestHandler = (req, res, next) => {
    res.setHeader('X-CloudCLI-Runtime-Mode', dependencies.runtimeMode);

    if (dependencies.runtimeMode === 'platform') {
      try {
        const user = dependencies.users.getFirstUser();
        if (!user) {
          return res.status(500).json({ error: 'Platform mode: No user found in database' });
        }
        (req as AuthenticationRequest).user = user;
        next();
        return;
      } catch (error) {
        console.error('Platform mode error:', error);
        res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
        return;
      }
    }

    if (
      dependencies.runtimeMode === 'desktop-local'
      && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && !isBrowserOriginAllowed({
        origin: req.headers.origin,
        requestHost: req.headers.host,
        secure: req.secure,
        allowedOrigin: dependencies.allowedDesktopOrigin,
        loopbackOnly: true,
      })
    ) {
      res.status(403).json({
        error: 'Desktop local request origin is not allowed.',
        code: 'AUTH_ORIGIN_INVALID',
      });
      return;
    }

    const credentials = resolveToken({
      cookieHeader: req.headers.cookie,
      authorizationHeader: req.headers.authorization,
    });
    if (!credentials.token) {
      res.setHeader('X-Auth-Error', 'invalid-token');
      res.status(401).json({
        error: 'Access denied. No session provided.',
        code: 'AUTH_TOKEN_INVALID',
      });
      return;
    }

    try {
      const verified = verifySessionToken(credentials.token);
      if (!verified) {
        res.setHeader('X-Auth-Error', 'invalid-token');
        res.status(401).json({
          error: 'Invalid session. User not found.',
          code: 'AUTH_TOKEN_INVALID',
        });
        return;
      }

      const secureCookie = req.secure;
      if (credentials.source === 'bearer') {
        res.append('Set-Cookie', serializeSessionCookie(credentials.token, { secure: secureCookie }));
      }

      if (verified.payload.exp && verified.payload.iat) {
        const now = Math.floor(Date.now() / 1000);
        const halfLife = (verified.payload.exp - verified.payload.iat) / 2;
        if (now > verified.payload.iat + halfLife) {
          const refreshedToken = generateSessionToken(verified.user);
          res.append('Set-Cookie', serializeSessionCookie(refreshedToken, { secure: secureCookie }));
          if (dependencies.runtimeMode !== 'desktop-local') {
            res.setHeader('X-Refreshed-Token', refreshedToken);
          }
        }
      }

      (req as AuthenticationRequest).user = verified.user;
      next();
    } catch (error) {
      res.append('Set-Cookie', serializeExpiredSessionCookie(req.secure));
      if (error instanceof jwt.TokenExpiredError) {
        res.setHeader('X-Auth-Error', 'session-expired');
        res.status(401).json({
          error: dependencies.runtimeMode === 'desktop-local'
            ? 'Local session expired. Reconnect through the Desktop app.'
            : 'Session expired. Please log in again.',
          code: 'AUTH_TOKEN_EXPIRED',
        });
        return;
      }

      console.warn(
        'Session verification failed:',
        error instanceof Error ? error.message : String(error),
      );
      res.setHeader('X-Auth-Error', 'invalid-token');
      res.status(401).json({ error: 'Invalid session', code: 'AUTH_TOKEN_INVALID' });
    }
  };

  const authenticateWebSocket = (
    credentials: WebSocketCredentials,
  ): AuthenticatedWebSocketUser | null => {
    if (dependencies.runtimeMode === 'platform') {
      try {
        const user = dependencies.users.getFirstUser();
        return user
          ? { id: Number(user.id), userId: Number(user.id), username: user.username }
          : null;
      } catch (error) {
        console.error('Platform mode WebSocket error:', error);
        return null;
      }
    }

    const { token } = resolveToken(credentials);
    if (!token) return null;
    try {
      const verified = verifySessionToken(token);
      return verified
        ? {
            id: Number(verified.user.id),
            userId: Number(verified.user.id),
            username: verified.user.username,
          }
        : null;
    } catch (error) {
      if (!(error instanceof jwt.TokenExpiredError)) {
        console.warn(
          'WebSocket session verification failed:',
          error instanceof Error ? error.message : String(error),
        );
      }
      return null;
    }
  };

  return { authenticateToken, authenticateWebSocket, generateToken: generateSessionToken };
}

// Use an installation-scoped secret unless deployment explicitly supplies one.
/** JWT signing secret consumed by Auth route tests that need production-equivalent tokens. */
export const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();

const productionAuthBoundary = createAuthBoundary({
  runtimeMode: RUNTIME_MODE,
  jwtSecret: JWT_SECRET,
  allowedDesktopOrigin: process.env.CLOUDCLI_DESKTOP_ALLOWED_ORIGIN,
  users: {
    getFirstUser: () => userDb.getFirstUser(),
    getUserById: (userId) => userDb.getUserById(userId),
  },
});

/** REST session middleware used by the server entrypoint and Auth routes. */
export const authenticateToken = productionAuthBoundary.authenticateToken;
/** WebSocket credential verifier injected into the WebSocket module by the server entrypoint. */
export const authenticateWebSocket = productionAuthBoundary.authenticateWebSocket;
/** Session token signer used by Auth services and scheduled-run test setup. */
export const generateToken = productionAuthBoundary.generateToken;

/** Optional deployment-wide API key guard used by the server entrypoint. */
export const validateApiKey: RequestHandler = (req, res, next) => {
  if (!process.env.API_KEY) {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  next();
};
