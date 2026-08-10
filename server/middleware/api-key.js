/**
 * Middleware to authenticate external agent / scheduled-run API requests.
 *
 * Supports two authentication modes:
 * 1. Platform mode (IS_PLATFORM=true): For managed/hosted deployments where
 *    authentication is handled by an external proxy. Requests are trusted and
 *    the default user context is used.
 *
 * 2. API key mode (default): For self-hosted deployments where users authenticate
 *    via API keys created in the UI. Keys are validated against the local database.
 *
 * Used by external agent routes and as the API-key fallback for scheduled runs.
 */

import { userDb, apiKeysDb } from '../modules/database/index.js';
import { IS_PLATFORM } from '../constants/config.js';

import { authenticateToken } from './auth.js';

export function validateExternalApiKeyOrJwt(req, res, next) {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && /^Bearer\s+/i.test(authorization)) {
    return authenticateToken(req, res, next);
  }
  return validateExternalApiKey(req, res, next);
}

export function validateExternalApiKey(req, res, next) {
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Platform mode: No user found in database' });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Platform mode error:', error);
      return res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
    }
  }

  const apiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const user = apiKeysDb.validateApiKey(apiKey);

  if (!user) {
    return res.status(401).json({ error: 'Invalid or inactive API key' });
  }

  req.user = user;
  next();
}
