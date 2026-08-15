import { IS_PLATFORM } from '../../constants/config';
import type { LLMProvider } from '../../types/app';
import { authenticatedFetch, getStoredAuthToken } from '../../utils/api';
import {
  PROVIDER_AUTH_STATUS_ENDPOINTS,
  type ProviderAuthStatus,
} from './types';

type ProviderAuthStatusPayload = {
  authenticated?: boolean;
  email?: string | null;
  method?: string | null;
  error?: string | null;
};

type ProviderAuthStatusApiResponse = {
  success: boolean;
  data: ProviderAuthStatusPayload;
};

type CacheEntry = {
  provider: LLMProvider;
  status: ProviderAuthStatus;
  expiresAt: number;
};

type InFlightEntry = {
  provider: LLMProvider;
  promise: Promise<ProviderAuthStatus>;
};

type ProviderAuthStatusCacheOptions = {
  force?: boolean;
};

type CreateProviderAuthStatusCacheOptions = {
  loadStatus: (
    provider: LLMProvider,
    options?: ProviderAuthStatusCacheOptions,
  ) => Promise<ProviderAuthStatus>;
  getScope: () => string;
  now?: () => number;
  ttlMs?: number;
};

const FALLBACK_STATUS_ERROR = 'Failed to check authentication status';
const FALLBACK_UNKNOWN_ERROR = 'Unknown error';

export const PROVIDER_AUTH_STATUS_CACHE_TTL_MS = 10_000;

const toErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : FALLBACK_UNKNOWN_ERROR
);

const toProviderAuthStatus = (
  payload: ProviderAuthStatusPayload,
  fallbackError: string | null = null,
): ProviderAuthStatus => ({
  authenticated: Boolean(payload.authenticated),
  email: payload.email ?? null,
  method: payload.method ?? null,
  error: payload.error ?? fallbackError,
  loading: false,
});

const readTokenIdentity = (token: string): string | null => {
  try {
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) {
      return null;
    }

    const base64Payload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = base64Payload.padEnd(
      base64Payload.length + ((4 - (base64Payload.length % 4)) % 4),
      '=',
    );
    const payload = JSON.parse(atob(paddedPayload)) as {
      userId?: unknown;
      username?: unknown;
    };

    if (
      !['string', 'number'].includes(typeof payload.userId)
      || typeof payload.username !== 'string'
    ) {
      return null;
    }

    return JSON.stringify([payload.userId, payload.username]);
  } catch {
    return null;
  }
};

export const getProviderAuthStatusCacheScope = (): string => {
  if (IS_PLATFORM) {
    return 'platform-user';
  }

  const token = getStoredAuthToken();
  if (!token) {
    return 'anonymous';
  }

  // Refreshed JWTs for the same user must share a cache scope, while statuses
  // from different authenticated users must never be reused.
  return `user:${readTokenIdentity(token) ?? token}`;
};

export function createProviderAuthStatusCache({
  loadStatus,
  getScope,
  now = Date.now,
  ttlMs = PROVIDER_AUTH_STATUS_CACHE_TTL_MS,
}: CreateProviderAuthStatusCacheOptions) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('Provider auth status cache TTL must be a finite positive number');
  }

  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, InFlightEntry>();
  const forcedInFlight = new Map<string, InFlightEntry>();
  const providerRevisions = new Map<LLMProvider, number>();
  let globalRevision = 0;

  const getRevision = (provider: LLMProvider): string => (
    `${globalRevision}:${providerRevisions.get(provider) ?? 0}`
  );

  const getBaseKey = (scope: string, provider: LLMProvider): string => (
    JSON.stringify([scope, provider])
  );

  const deleteProviderEntries = <T extends { provider: LLMProvider }>(
    entries: Map<string, T>,
    provider: LLMProvider,
  ) => {
    entries.forEach((entry, key) => {
      if (entry.provider === provider) {
        entries.delete(key);
      }
    });
  };

  const invalidate = (provider?: LLMProvider) => {
    if (!provider) {
      globalRevision += 1;
      cache.clear();
      forcedInFlight.clear();
      return;
    }

    providerRevisions.set(provider, (providerRevisions.get(provider) ?? 0) + 1);
    deleteProviderEntries(cache, provider);
    deleteProviderEntries(forcedInFlight, provider);
  };

  const load = (
    provider: LLMProvider,
    { force = false }: ProviderAuthStatusCacheOptions = {},
  ): Promise<ProviderAuthStatus> => {
    const scope = getScope();
    const baseKey = getBaseKey(scope, provider);

    if (force) {
      const existingForcedRequest = forcedInFlight.get(baseKey);
      if (existingForcedRequest) {
        return existingForcedRequest.promise;
      }
      invalidate(provider);
    } else {
      const cached = cache.get(baseKey);
      if (cached && cached.expiresAt > now()) {
        return Promise.resolve(cached.status);
      }
      if (cached) {
        cache.delete(baseKey);
      }
    }

    const revision = getRevision(provider);
    const requestKey = JSON.stringify([scope, provider, revision]);
    const existingRequest = inFlight.get(requestKey);
    if (existingRequest) {
      return existingRequest.promise;
    }

    const promise = loadStatus(provider, { force })
      .then((status) => {
        if (getScope() === scope && getRevision(provider) === revision) {
          cache.set(baseKey, {
            provider,
            status,
            expiresAt: now() + ttlMs,
          });
        }
        return status;
      })
      .finally(() => {
        if (inFlight.get(requestKey)?.promise === promise) {
          inFlight.delete(requestKey);
        }
        if (forcedInFlight.get(baseKey)?.promise === promise) {
          forcedInFlight.delete(baseKey);
        }
      });

    const entry = { provider, promise };
    inFlight.set(requestKey, entry);
    if (force) {
      forcedInFlight.set(baseKey, entry);
    }
    return promise;
  };

  return {
    getRevision,
    invalidate,
    load,
  };
}

const loadProviderAuthStatus = async (
  provider: LLMProvider,
  { force = false }: ProviderAuthStatusCacheOptions = {},
): Promise<ProviderAuthStatus> => {
  try {
    const endpoint = PROVIDER_AUTH_STATUS_ENDPOINTS[provider];
    const response = await authenticatedFetch(`${endpoint}${force ? '?force=1' : ''}`);
    if (!response.ok) {
      return {
        authenticated: false,
        email: null,
        method: null,
        loading: false,
        error: FALLBACK_STATUS_ERROR,
      };
    }

    const payload = (await response.json()) as ProviderAuthStatusApiResponse;
    return toProviderAuthStatus(payload.data);
  } catch (caughtError) {
    console.error(`Error checking ${provider} auth status:`, caughtError);
    return {
      authenticated: false,
      email: null,
      method: null,
      loading: false,
      error: toErrorMessage(caughtError),
    };
  }
};

const providerAuthStatusCache = createProviderAuthStatusCache({
  loadStatus: loadProviderAuthStatus,
  getScope: getProviderAuthStatusCacheScope,
});

export const getProviderAuthStatusCacheRevision = (provider: LLMProvider): string => (
  providerAuthStatusCache.getRevision(provider)
);

export const invalidateProviderAuthStatusCache = (provider?: LLMProvider): void => {
  providerAuthStatusCache.invalidate(provider);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('provider-auth-status-invalidated', {
      detail: { provider: provider ?? null },
    }));
  }
};

export const requestProviderAuthStatus = async (
  provider: LLMProvider,
  options?: ProviderAuthStatusCacheOptions,
): Promise<ProviderAuthStatus> => {
  const status = await providerAuthStatusCache.load(provider, options);
  if (options?.force && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('provider-auth-status-invalidated', {
      detail: { provider, refreshed: true },
    }));
  }
  return status;
};
