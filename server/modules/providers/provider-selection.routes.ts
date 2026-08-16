import express, { type Request, type Response } from 'express';

import { providerSelectionService } from '@/modules/providers/services/provider-selection.service.js';
import type { ProviderSelectionCatalog } from '@/shared/types.js';
import { asyncHandler, createApiSuccessResponse, readAuthenticatedUserId } from '@/shared/utils.js';

type ProviderSelectionCatalogRouteService = {
  getPublicSelectionCatalog(userId: number): Promise<ProviderSelectionCatalog>;
};

/**
 * Creates the provider catalog transport used by provider.routes.ts and its
 * route contract tests. Business decisions stay in providerSelectionService;
 * this router only reads auth context and serializes the typed JSON envelope.
 */
export function createProviderSelectionCatalogRouter(
  service: ProviderSelectionCatalogRouteService = providerSelectionService,
) {
  const router = express.Router();
  router.get(
    '/selection-catalog',
    asyncHandler(async (request: Request, response: Response) => {
      const userId = readAuthenticatedUserId(request);
      const catalog = await service.getPublicSelectionCatalog(userId);
      response.json(createApiSuccessResponse(catalog));
    }),
  );
  return router;
}
