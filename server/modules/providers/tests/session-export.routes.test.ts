import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import providerRoutes from '@/modules/providers/provider.routes.js';
import { sessionExportService } from '@/modules/providers/services/session-export.service.js';

test('session ZIP route remains behind auth and returns a downloadable archive', async () => {
  const digest = 'a'.repeat(64);
  const calls: Array<{ sessionId: string; format: string; expectedDigest: string }> = [];
  const originalExport = sessionExportService.exportSession;
  const app = express();
  app.use('/api/providers', (request, response, next) => {
    if (request.headers.authorization !== 'Bearer local-session') {
      response.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED' } });
      return;
    }
    next();
  });
  sessionExportService.exportSession = async (sessionId, format, expectedDigest) => {
    calls.push({ sessionId, format, expectedDigest });
    return {
      buffer: Buffer.from('zip'),
      filename: 'cursor-chat.zip',
      contentType: 'application/zip',
    };
  };
  app.use('/api/providers', providerRoutes);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/api/providers/sessions/cursor-session/export?format=zip&expectedDigest=${digest}`;
    const unauthorized = await fetch(url);
    assert.equal(unauthorized.status, 401);
    assert.equal(calls.length, 0);

    const response = await fetch(url, {
      headers: { authorization: 'Bearer local-session' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(response.headers.get('content-disposition') ?? '', /cursor-chat\.zip/);
    assert.equal(await response.text(), 'zip');
    assert.deepEqual(calls, [{ sessionId: 'cursor-session', format: 'zip', expectedDigest: digest }]);
  } finally {
    sessionExportService.exportSession = originalExport;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
