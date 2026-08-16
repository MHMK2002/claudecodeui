import express from 'express';
import type { RequestHandler } from 'express';

import type { RuntimeMode } from '@/shared/types.js';
import {
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from '@/shared/utils.js';

import {
  DESKTOP_SESSION_NONCE_HEADER,
  DESKTOP_SESSION_SECRET_HEADER,
} from '../../../shared/local-session.js';

import type { createAuthService } from './auth.service.js';
import type { createDesktopSessionService } from './desktop-session.service.js';

type AuthenticatedRequest = express.Request & { user?: unknown };

type AuthRouterDependencies = {
  service: ReturnType<typeof createAuthService>;
  desktopSessions: ReturnType<typeof createDesktopSessionService>;
  authenticateToken: RequestHandler;
  runtimeMode: RuntimeMode;
};

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Creates the Auth transport adapter. Handlers only parse transport values,
 * delegate session/user behavior, and translate the result to cookie/JSON or
 * redirect responses.
 */
export function createAuthRouter(dependencies: AuthRouterDependencies): express.Router {
  const router = express.Router();

  const setSessionCookie = (req: express.Request, res: express.Response, token: string) => {
    res.append('Set-Cookie', serializeSessionCookie(token, { secure: req.secure }));
  };

  router.get('/status', (_req, res, next) => {
    try {
      res.json(dependencies.service.getStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post('/desktop-bootstrap', async (req, res, next) => {
    try {
      const session = await dependencies.desktopSessions.bootstrap({
        providedSecret: readSingleHeader(req.headers[DESKTOP_SESSION_SECRET_HEADER]),
        nonce: readSingleHeader(req.headers[DESKTOP_SESSION_NONCE_HEADER]),
        remoteAddress: req.socket.remoteAddress,
      });
      setSessionCookie(req, res, session.token);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, user: session.user, runtimeMode: dependencies.runtimeMode });
    } catch (error) {
      next(error);
    }
  });

  router.post('/desktop-handoff', (req, res, next) => {
    try {
      const handoff = dependencies.desktopSessions.registerBrowserHandoff({
        providedSecret: readSingleHeader(req.headers[DESKTOP_SESSION_SECRET_HEADER]),
        nonce: readSingleHeader(req.headers[DESKTOP_SESSION_NONCE_HEADER]),
        remoteAddress: req.socket.remoteAddress,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(handoff);
    } catch (error) {
      next(error);
    }
  });

  router.post('/desktop-lan-credentials', async (req, res, next) => {
    try {
      const body = req.body as { username?: unknown; password?: unknown };
      const result = await dependencies.desktopSessions.configureLanCredentials({
        providedSecret: readSingleHeader(req.headers[DESKTOP_SESSION_SECRET_HEADER]),
        nonce: readSingleHeader(req.headers[DESKTOP_SESSION_NONCE_HEADER]),
        remoteAddress: req.socket.remoteAddress,
        username: body.username,
        password: body.password,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/desktop-handoff/:nonce', async (req, res, next) => {
    try {
      const session = await dependencies.desktopSessions.consumeBrowserHandoff(
        req.params.nonce,
        req.socket.remoteAddress,
      );
      setSessionCookie(req, res, session.token);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.redirect(303, '/');
    } catch (error) {
      next(error);
    }
  });

  router.post('/register', async (req, res, next) => {
    try {
      const body = req.body as { username?: unknown; password?: unknown };
      const session = await dependencies.service.register(body.username, body.password);
      setSessionCookie(req, res, session.token);
      res.json(session);
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const body = req.body as { username?: unknown; password?: unknown };
      const session = await dependencies.service.login(body.username, body.password);
      setSessionCookie(req, res, session.token);
      res.json(session);
    } catch (error) {
      next(error);
    }
  });

  router.get('/user', dependencies.authenticateToken, (req, res) => {
    res.json(dependencies.service.getCurrentUser((req as AuthenticatedRequest).user));
  });

  router.post('/refresh', dependencies.authenticateToken, (req, res) => {
    const session = dependencies.service.refreshSession((req as AuthenticatedRequest).user);
    setSessionCookie(req, res, session.token);
    res.json(dependencies.runtimeMode === 'desktop-local'
      ? { success: true }
      : session);
  });

  router.post('/logout', dependencies.authenticateToken, (_req, res) => {
    res.append('Set-Cookie', serializeExpiredSessionCookie());
    res.json(dependencies.service.logout());
  });

  return router;
}
