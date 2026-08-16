/**
 * Middleware for external agent and scheduled-run requests. Browser/UI callers
 * use the same cookie/Bearer session boundary as every protected REST route;
 * machine callers may fall back to an explicit `x-api-key` header.
 */
import type { Request, RequestHandler } from 'express';

import { apiKeysDb, userDb } from '@/modules/database/index.js';
import { IS_PLATFORM, SESSION_COOKIE_NAME, readCookieValue } from '@/shared/utils.js';

import { authenticateToken } from './auth.middleware.js';

type AuthenticationRequest = Request & { user?: unknown };

/** Scheduled-runs and Agent routes accept a UI session before API-key fallback. */
export const validateExternalApiKeyOrJwt: RequestHandler = (req, res, next) => {
  const authorization = req.headers.authorization;
  const hasBearer = typeof authorization === 'string' && /^Bearer\s+/i.test(authorization);
  const hasSessionCookie = Boolean(readCookieValue(req.headers.cookie, SESSION_COOKIE_NAME));
  if (hasBearer || hasSessionCookie || IS_PLATFORM) {
    authenticateToken(req, res, next);
    return;
  }
  validateExternalApiKey(req, res, next);
};

/** External automation API-key fallback; secrets are accepted only in headers. */
export const validateExternalApiKey: RequestHandler = (req, res, next) => {
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        res.status(500).json({ error: 'Platform mode: No user found in database' });
        return;
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

  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey !== 'string' || !apiKey) {
    res.status(401).json({ error: 'API key required' });
    return;
  }

  const user = apiKeysDb.validateApiKey(apiKey);
  if (!user) {
    res.status(401).json({ error: 'Invalid or inactive API key' });
    return;
  }

  (req as AuthenticationRequest).user = user;
  next();
};
