import { useCallback, useEffect, useRef, useState } from 'react';
import type { LLMProvider } from '../../../types/app';
import {
  CLI_PROVIDERS,
  createInitialProviderAuthStatusMap,
} from '../types';
import type {
  ProviderAuthStatus,
  ProviderAuthStatusMap,
} from '../types';
import {
  getProviderAuthStatusCacheRevision,
  getProviderAuthStatusCacheScope,
  requestProviderAuthStatus,
} from '../providerAuthStatusCache';

type UseProviderAuthStatusOptions = {
  initialLoading?: boolean;
};

type ProviderAuthStatusCheckOptions = {
  force?: boolean;
};

export function useProviderAuthStatus(
  { initialLoading = true }: UseProviderAuthStatusOptions = {},
) {
  const [providerAuthStatus, setProviderAuthStatus] = useState<ProviderAuthStatusMap>(() => (
    createInitialProviderAuthStatusMap(initialLoading)
  ));
  const isMountedRef = useRef(true);
  const requestVersionsRef = useRef<Record<LLMProvider, number>>({
    claude: 0,
    cursor: 0,
    codex: 0,
    opencode: 0,
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const setProviderLoading = useCallback((provider: LLMProvider) => {
    setProviderAuthStatus((previous) => ({
      ...previous,
      [provider]: {
        ...previous[provider],
        loading: true,
        error: null,
      },
    }));
  }, []);

  const setProviderStatus = useCallback((provider: LLMProvider, status: ProviderAuthStatus) => {
    setProviderAuthStatus((previous) => ({
      ...previous,
      [provider]: status,
    }));
  }, []);

  const checkProviderAuthStatus = useCallback(async (
    provider: LLMProvider,
    options: ProviderAuthStatusCheckOptions = {},
  ): Promise<ProviderAuthStatus> => {
    const requestVersion = requestVersionsRef.current[provider] + 1;
    requestVersionsRef.current[provider] = requestVersion;
    if (isMountedRef.current) {
      setProviderLoading(provider);
    }

    const requestScope = getProviderAuthStatusCacheScope();
    const request = requestProviderAuthStatus(provider, options);
    const requestRevision = getProviderAuthStatusCacheRevision(provider);
    const status = await request;

    if (
      isMountedRef.current
      && requestVersionsRef.current[provider] === requestVersion
      && getProviderAuthStatusCacheScope() === requestScope
      && getProviderAuthStatusCacheRevision(provider) === requestRevision
    ) {
      setProviderStatus(provider, status);
    }
    return status;
  }, [setProviderLoading, setProviderStatus]);

  const refreshProviderAuthStatuses = useCallback(async (
    providers: LLMProvider[] = CLI_PROVIDERS,
    options: ProviderAuthStatusCheckOptions = {},
  ) => {
    await Promise.all(providers.map((provider) => checkProviderAuthStatus(provider, options)));
  }, [checkProviderAuthStatus]);

  useEffect(() => {
    const handleProfilesUpdated = (event: Event) => {
      const provider = (event as CustomEvent<{ provider?: unknown }>).detail?.provider;
      if (typeof provider === 'string' && CLI_PROVIDERS.includes(provider as LLMProvider)) {
        void checkProviderAuthStatus(provider as LLMProvider);
      }
    };

    window.addEventListener('provider-profiles-updated', handleProfilesUpdated);
    return () => {
      window.removeEventListener('provider-profiles-updated', handleProfilesUpdated);
    };
  }, [checkProviderAuthStatus]);

  return {
    providerAuthStatus,
    setProviderAuthStatus,
    checkProviderAuthStatus,
    refreshProviderAuthStatuses,
  };
}
