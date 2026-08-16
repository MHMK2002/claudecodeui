import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import providerRoutes from '@/modules/providers/provider.routes.js';
import { sessionRewindService } from '@/modules/providers/services/session-rewind.service.js';
import { AppError } from '@/shared/utils.js';

test('legacy message PATCH rejects transactional edit before any rewind mutation', async () => {
  const originalRewind = sessionRewindService.rewind;
  let rewindCalls = 0;
  sessionRewindService.rewind = async (..._args: Parameters<typeof originalRewind>) => {
    rewindCalls += 1;
    throw new Error('rewind must not be reached');
  };

  const app = express();
  app.use(express.json());
  app.use('/api/providers', providerRoutes);
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const appError = error instanceof AppError
      ? error
      : new AppError('Internal server error', { code: 'INTERNAL_ERROR', statusCode: 500 });
    response.status(appError.statusCode).json({
      success: false,
      error: { code: appError.code, message: appError.message },
    });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/providers/sessions/session-1/messages/message-1`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'replacement' }),
      },
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      success: false,
      error: {
        code: 'TRANSACTIONAL_EDIT_UNAVAILABLE',
        message: 'Transactional edit and resubmit is unavailable. Copy the message to the composer instead.',
      },
    });
    assert.equal(rewindCalls, 0);
  } finally {
    sessionRewindService.rewind = originalRewind;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
