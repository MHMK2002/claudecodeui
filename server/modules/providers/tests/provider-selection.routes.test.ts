import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { createProviderSelectionCatalogRouter } from '@/modules/providers/provider-selection.routes.js';
import type { ProviderSelectionCatalog } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const catalog: ProviderSelectionCatalog = {
  providers: [{
    provider: 'claude',
    available: true,
    connectionAvailable: false,
    unavailableReason: null,
    profiles: [{ id: 4, title: 'Local', isDefault: true }],
    models: { OPTIONS: [{ value: 'sonnet', label: 'Sonnet' }], DEFAULT: 'sonnet' },
  }],
};

async function withCatalogServer(
  getPublicSelectionCatalog: (userId: number) => Promise<ProviderSelectionCatalog>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use((request, _response, next) => {
    (request as typeof request & { user: { id: number } }).user = { id: 7 };
    next();
  });
  app.use('/api/providers', createProviderSelectionCatalogRouter({ getPublicSelectionCatalog }));
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
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('selection catalog route returns the typed JSON success envelope', async () => {
  const userIds: number[] = [];
  await withCatalogServer(async (userId) => {
    userIds.push(userId);
    return catalog;
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/providers/selection-catalog`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
    assert.deepEqual(await response.json(), { success: true, data: catalog });
  });
  assert.deepEqual(userIds, [7]);
});

test('selection catalog route keeps service failures in a typed JSON error envelope', async () => {
  await withCatalogServer(async () => {
    throw new AppError('Catalog service is unavailable.', {
      code: 'CATALOG_UNAVAILABLE',
      statusCode: 503,
    });
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/providers/selection-catalog`);
    assert.equal(response.status, 503);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
    assert.deepEqual(await response.json(), {
      success: false,
      error: { code: 'CATALOG_UNAVAILABLE', message: 'Catalog service is unavailable.' },
    });
  });
});
