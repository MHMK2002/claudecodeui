import assert from 'node:assert/strict';
import test from 'node:test';

import type { NextFunction, Request, Response } from 'express';

import { createAuthBoundary } from '../auth.middleware.js';

const USER = { id: 9, username: 'owner' };

function createBoundary(
  runtimeMode: 'desktop-local' | 'desktop-lan' | 'standalone-web' | 'platform',
  allowedDesktopOrigin?: string,
) {
  return createAuthBoundary({
    runtimeMode,
    jwtSecret: 'test-only-jwt-secret',
    allowedDesktopOrigin,
    users: {
      getFirstUser: () => USER,
      getUserById: (userId) => userId === USER.id ? USER : undefined,
    },
  });
}

function executeMiddleware(
  boundary: ReturnType<typeof createBoundary>,
  options: {
    headers?: Record<string, string>;
    method?: string;
    host?: string;
    origin?: string;
  } = {},
) {
  const headers = { ...options.headers };
  if (options.host) headers.host = options.host;
  if (options.origin) headers.origin = options.origin;
  const responseHeaders = new Map<string, string | string[]>();
  let statusCode = 200;
  let payload: unknown;
  let nextCalled = false;
  const request = {
    headers,
    method: options.method ?? 'GET',
    secure: false,
  } as unknown as Request;
  const response = {
    setHeader(name: string, value: string | string[]) {
      responseHeaders.set(name, value);
      return this;
    },
    append(name: string, value: string) {
      const previous = responseHeaders.get(name);
      responseHeaders.set(name, previous
        ? [...(Array.isArray(previous) ? previous : [previous]), value]
        : value);
      return this;
    },
    status(value: number) {
      statusCode = value;
      return this;
    },
    json(value: unknown) {
      payload = value;
      return this;
    },
  } as unknown as Response;
  const next = (() => { nextCalled = true; }) as NextFunction;

  boundary.authenticateToken(request, response, next);
  return {
    request: request as Request & { user?: unknown },
    responseHeaders,
    getStatusCode: () => statusCode,
    getPayload: () => payload,
    wasNextCalled: () => nextCalled,
  };
}

test('desktop-local REST and WebSocket accept the HttpOnly cookie but reject Bearer-only auth', () => {
  const boundary = createBoundary('desktop-local');
  const token = boundary.generateToken(USER);

  const bearerAttempt = executeMiddleware(boundary, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(bearerAttempt.wasNextCalled(), false);
  assert.equal(bearerAttempt.getStatusCode(), 401);

  const cookieAttempt = executeMiddleware(boundary, {
    headers: { cookie: `cloudcli_session=${token}` },
  });
  assert.equal(cookieAttempt.wasNextCalled(), true);
  assert.equal(cookieAttempt.request.user, USER);

  assert.equal(boundary.authenticateWebSocket({ authorizationHeader: `Bearer ${token}` }), null);
  assert.equal(
    boundary.authenticateWebSocket({ cookieHeader: `cloudcli_session=${token}` })?.userId,
    USER.id,
  );
});

test('standalone and LAN preserve explicit Bearer auth while migrating it to a cookie', () => {
  for (const runtimeMode of ['standalone-web', 'desktop-lan'] as const) {
    const boundary = createBoundary(runtimeMode);
    const token = boundary.generateToken(USER);
    const attempt = executeMiddleware(boundary, {
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(attempt.wasNextCalled(), true);
    const setCookie = attempt.responseHeaders.get('Set-Cookie');
    assert.match(Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie), /cloudcli_session=/);
    assert.equal(
      boundary.authenticateWebSocket({ authorizationHeader: `Bearer ${token}` })?.userId,
      USER.id,
    );
  }
});

test('explicit Bearer auth overrides a stale standalone or LAN cookie', () => {
  for (const runtimeMode of ['standalone-web', 'desktop-lan'] as const) {
    const boundary = createBoundary(runtimeMode);
    const token = boundary.generateToken(USER);
    const attempt = executeMiddleware(boundary, {
      headers: {
        authorization: `Bearer ${token}`,
        cookie: 'cloudcli_session=stale.invalid.cookie',
      },
    });

    assert.equal(attempt.wasNextCalled(), true);
    assert.equal(attempt.request.user, USER);
  }
});

test('platform resolves the database principal without session credentials', () => {
  const boundary = createBoundary('platform');
  const attempt = executeMiddleware(boundary);

  assert.equal(attempt.wasNextCalled(), true);
  assert.equal(attempt.request.user, USER);
  assert.equal(boundary.authenticateWebSocket({})?.userId, USER.id);
});

test('duplicate session cookies are rejected', () => {
  const boundary = createBoundary('desktop-local');
  const token = boundary.generateToken(USER);
  const attempt = executeMiddleware(boundary, {
    headers: { cookie: `cloudcli_session=${token}; cloudcli_session=${token}` },
  });

  assert.equal(attempt.wasNextCalled(), false);
  assert.equal(attempt.getStatusCode(), 401);
  assert.deepEqual(attempt.getPayload(), {
    error: 'Access denied. No session provided.',
    code: 'AUTH_TOKEN_INVALID',
  });
});

test('desktop-local accepts REST mutations from the exact server origin', () => {
  const boundary = createBoundary('desktop-local');
  const token = boundary.generateToken(USER);
  const attempt = executeMiddleware(boundary, {
    method: 'POST',
    host: 'localhost:3001',
    origin: 'http://localhost:3001',
    headers: { cookie: `cloudcli_session=${token}` },
  });

  assert.equal(attempt.wasNextCalled(), true);
  assert.equal(attempt.request.user, USER);
});

test('desktop-local rejects REST mutations from a sibling localhost port', () => {
  const boundary = createBoundary('desktop-local');
  const token = boundary.generateToken(USER);
  const attempt = executeMiddleware(boundary, {
    method: 'POST',
    host: 'localhost:3001',
    origin: 'http://localhost:4444',
    headers: { cookie: `cloudcli_session=${token}` },
  });

  assert.equal(attempt.wasNextCalled(), false);
  assert.equal(attempt.getStatusCode(), 403);
  assert.deepEqual(attempt.getPayload(), {
    error: 'Desktop local request origin is not allowed.',
    code: 'AUTH_ORIGIN_INVALID',
  });
});

test('desktop-local accepts an explicitly configured loopback dev origin', () => {
  const boundary = createBoundary('desktop-local', 'http://localhost:5173');
  const token = boundary.generateToken(USER);
  const attempt = executeMiddleware(boundary, {
    method: 'POST',
    host: 'localhost:3001',
    origin: 'http://localhost:5173',
    headers: { cookie: `cloudcli_session=${token}` },
  });

  assert.equal(attempt.wasNextCalled(), true);
  assert.equal(attempt.request.user, USER);
});

test('desktop-local GET cookie auth remains available without an Origin header', () => {
  const boundary = createBoundary('desktop-local');
  const token = boundary.generateToken(USER);
  const attempt = executeMiddleware(boundary, {
    method: 'GET',
    host: 'localhost:3001',
    headers: { cookie: `cloudcli_session=${token}` },
  });

  assert.equal(attempt.wasNextCalled(), true);
  assert.equal(attempt.request.user, USER);
});
