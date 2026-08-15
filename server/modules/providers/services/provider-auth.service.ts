import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider, ProviderAuthStatus } from '@/shared/types.js';

const AUTH_STATUS_TTL_MS = 5_000;

type ProviderAuthServiceDependencies = {
  resolveProvider?: typeof providerRegistry.resolveProvider;
  now?: () => number;
  ttlMs?: number;
};

/**
 * Creates the provider auth-status service used by provider routes and runtime
 * preflight checks. A per-provider TTL and shared in-flight promise prevent
 * repeated Settings mounts from spawning duplicate CLI status processes.
 * Tests use the factory to supply deterministic provider and clock stubs.
 */
export function createProviderAuthService(dependencies: ProviderAuthServiceDependencies = {}) {
  const resolveProvider = dependencies.resolveProvider ?? providerRegistry.resolveProvider;
  const now = dependencies.now ?? Date.now;
  const ttlMs = dependencies.ttlMs ?? AUTH_STATUS_TTL_MS;
  const cache = new Map<string, { value: ProviderAuthStatus; expiresAt: number }>();
  const inFlight = new Map<string, Promise<ProviderAuthStatus>>();
  const generations = new Map<string, number>();

  const service = {
    /** Returns status, sharing concurrent work and reusing a recent success. */
    async getProviderAuthStatus(
      providerName: string,
      options: { forceRefresh?: boolean } = {},
    ): Promise<ProviderAuthStatus> {
      const key = providerName.toLowerCase();
      const activeRequest = inFlight.get(key);
      if (activeRequest) return activeRequest;
      if (options.forceRefresh) {
        service.invalidateProviderAuthStatus(key);
      } else {
        const cached = cache.get(key);
        if (cached && cached.expiresAt > now()) return cached.value;
      }

      const generation = generations.get(key) ?? 0;
      const pending = resolveProvider(key).auth.getStatus().then((value) => {
        if ((generations.get(key) ?? 0) === generation) {
          cache.set(key, { value, expiresAt: now() + ttlMs });
        }
        return value;
      }).finally(() => {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      });
      inFlight.set(key, pending);
      return pending;
    },

    /** Invalidates one provider, or all providers after an auth transition. */
    invalidateProviderAuthStatus(providerName?: string): void {
      if (!providerName) {
        const keys = new Set([...cache.keys(), ...inFlight.keys(), ...generations.keys()]);
        keys.forEach((key) => generations.set(key, (generations.get(key) ?? 0) + 1));
        cache.clear();
        inFlight.clear();
        return;
      }
      const key = providerName.toLowerCase();
      generations.set(key, (generations.get(key) ?? 0) + 1);
      cache.delete(key);
      inFlight.delete(key);
    },

    /** Runtime preflight consumer; preserves the original runtime error on lookup failure. */
    async isProviderInstalled(providerName: LLMProvider): Promise<boolean> {
      try {
        const status = await service.getProviderAuthStatus(providerName);
        return status.installed;
      } catch {
        return true;
      }
    },
  };

  return service;
}

/** Singleton consumed by provider routes and provider runtime services. */
export const providerAuthService = createProviderAuthService();
