import assert from 'node:assert/strict';
import test from 'node:test';

import type { VerifyClientCallbackSync } from 'ws';

import type { AuthenticatedWebSocketRequest, RuntimeMode } from '@/shared/types.js';

import { verifyWebSocketClient } from '../services/websocket-auth.service.js';

function createInfo(options: {
  url: string;
  remoteAddress?: string;
  cookie?: string;
  origin?: string;
  host?: string;
}) {
  const request = {
    url: options.url,
    headers: { cookie: options.cookie, host: options.host ?? 'localhost:3001' },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
  } as unknown as AuthenticatedWebSocketRequest;
  const info = {
    origin: options.origin ?? 'http://localhost:3001',
    secure: false,
    req: request,
  } as Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0];
  return { info, request };
}

function dependencies(runtimeMode: RuntimeMode, onAuthenticate = () => undefined) {
  return {
    runtimeMode,
    authenticateWebSocket: (credentials: {
      cookieHeader?: string | string[];
      authorizationHeader?: string | string[];
    }) => {
      onAuthenticate();
      return credentials.cookieHeader === 'cloudcli_session=signed'
        ? { id: 1, userId: 1, username: 'owner' }
        : null;
    },
  };
}

test('WebSocket query credentials are rejected before authentication', () => {
  let authenticateCalls = 0;
  const { info } = createInfo({
    url: '/ws?token=signed',
    cookie: 'cloudcli_session=signed',
  });

  assert.equal(
    verifyWebSocketClient(info, dependencies('desktop-local', () => { authenticateCalls += 1; })),
    false,
  );
  assert.equal(authenticateCalls, 0);
});

test('clean WebSocket URLs authenticate from the shared cookie', () => {
  const { info, request } = createInfo({
    url: '/ws',
    cookie: 'cloudcli_session=signed',
  });

  assert.equal(verifyWebSocketClient(info, dependencies('desktop-local')), true);
  assert.equal(request.user?.username, 'owner');
});

test('desktop-local rejects cross-site WebSocket origins even with a valid cookie', () => {
  const { info } = createInfo({
    url: '/ws',
    origin: 'https://attacker.example',
    cookie: 'cloudcli_session=signed',
  });

  assert.equal(verifyWebSocketClient(info, dependencies('desktop-local')), false);
});

test('desktop-local rejects a sibling localhost port with the ambient cookie', () => {
  const { info } = createInfo({
    url: '/voice-stream',
    host: 'localhost:3001',
    origin: 'http://localhost:4444',
    cookie: 'cloudcli_session=signed',
  });

  assert.equal(verifyWebSocketClient(info, dependencies('desktop-local')), false);
});

test('desktop-local permits only an explicitly configured loopback dev origin exception', () => {
  const { info } = createInfo({
    url: '/ws',
    host: 'localhost:3001',
    origin: 'http://localhost:5173',
    cookie: 'cloudcli_session=signed',
  });

  assert.equal(verifyWebSocketClient(info, {
    ...dependencies('desktop-local'),
    allowedDesktopOrigin: 'http://localhost:5173',
  }), true);
});

test('Shell is loopback-only and disabled in LAN and platform modes', () => {
  for (const pathname of ['/shell', '/command-terminal']) {
    const local = createInfo({
      url: pathname,
      cookie: 'cloudcli_session=signed',
    });
    assert.equal(verifyWebSocketClient(local.info, dependencies('desktop-local')), true);

    const remote = createInfo({
      url: pathname,
      remoteAddress: '192.168.1.20',
      cookie: 'cloudcli_session=signed',
    });
    assert.equal(verifyWebSocketClient(remote.info, dependencies('standalone-web')), false);

    const reverseProxiedRemote = createInfo({
      url: pathname,
      remoteAddress: '127.0.0.1',
      origin: 'https://remote.example.com',
      cookie: 'cloudcli_session=signed',
    });
    assert.equal(
      verifyWebSocketClient(reverseProxiedRemote.info, dependencies('standalone-web')),
      false,
    );

    for (const runtimeMode of ['desktop-lan', 'platform'] as const) {
      const blocked = createInfo({
        url: pathname,
        cookie: 'cloudcli_session=signed',
      });
      assert.equal(verifyWebSocketClient(blocked.info, dependencies(runtimeMode)), false);
    }
  }
});
