import { useCallback, useEffect, useState } from 'react';

import {
  AUTH_SESSION_EXPIRED_EVENT,
  authenticatedFetch,
} from '../../utils/api';
import type {
  LLMProvider,
  ProviderModelsDefinition,
  ProviderSelectionCatalog,
  ProviderSelectionCatalogEntry,
  ProviderSelectionCatalogProfile,
  ResolvedProviderSelection,
} from '../../types/app';

type SelectionCatalogApiResponse = {
  success?: boolean;
  data?: ProviderSelectionCatalog;
};

const CATALOG_TTL_MS = 15_000;
let cachedCatalog: { value: ProviderSelectionCatalog; expiresAt: number } | null = null;
let catalogGeneration = 0;
let inFlightCatalog: { generation: number; promise: Promise<ProviderSelectionCatalog> } | null = null;
const invalidationListeners = new Set<() => void>();
let authListenerSubscribers = 0;

async function requestProviderSelectionCatalog(force = false): Promise<ProviderSelectionCatalog> {
  if (!force && cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return cachedCatalog.value;
  }
  if (inFlightCatalog?.generation === catalogGeneration) {
    return inFlightCatalog.promise;
  }

  const requestGeneration = catalogGeneration;
  const promise = (async () => {
    const response = await authenticatedFetch('/api/providers/selection-catalog');
    const body = (await response.json()) as SelectionCatalogApiResponse;
    if (!response.ok || !body.success || !Array.isArray(body.data?.providers)) {
      throw new Error('Failed to load the provider selection catalog.');
    }
    const value = { providers: body.data.providers };
    if (requestGeneration === catalogGeneration) {
      cachedCatalog = { value, expiresAt: Date.now() + CATALOG_TTL_MS };
    }
    return value;
  })();
  inFlightCatalog = { generation: requestGeneration, promise };
  void promise.finally(() => {
    if (inFlightCatalog?.promise === promise) inFlightCatalog = null;
  }).catch(() => undefined);
  return promise;
}

/** Invalidates every picker after an auth/profile/connection Settings change. */
export function invalidateProviderSelectionCatalog(): void {
  catalogGeneration += 1;
  cachedCatalog = null;
  inFlightCatalog = null;
  invalidationListeners.forEach((listener) => listener());
}

export type ProviderSelectionCatalogState = {
  /** The fetched catalog; null until it first loads successfully. */
  catalog: ProviderSelectionCatalog | null;
  /** True while the initial load is in flight. */
  loading: boolean;
  /** Set when the catalog request failed (e.g. offline). */
  error: string | null;
  /** Re-fetches the catalog (e.g. after settings changed). */
  reload: () => void;
  /** Catalog entry by provider id, regardless of availability. */
  getEntry: (provider: LLMProvider) => ProviderSelectionCatalogEntry | null;
  /** Only-available view used by pickers when unavailable entries are hidden. */
  listAvailable: () => ProviderSelectionCatalogEntry[];
};

/**
 * True for providers whose execution requires a user-managed provider profile.
 * A null providerProfileId is invalid for these (legacy Local CLI), while it is
 * the natural architecture for connection-backed providers.
 */
export function isProfileProvider(provider: LLMProvider): provider is 'claude' | 'codex' {
  return provider === 'claude' || provider === 'codex';
}

/**
 * Fetches and exposes the shared provider selection catalog
 * (`GET /api/providers/selection-catalog`) plus pure lookup helpers.
 *
 * Every picker (composer menu, empty-state picker, fork dialog, task Q&A
 * modal) consumes this instead of hard-coded provider metadata so
 * availability, profiles, and models always come from one backend source.
 *
 * Concurrent mounts share one request and a short TTL. Invalidation starts a
 * new generation, so a slower stale response cannot overwrite fresh Settings.
 */
export function useProviderSelectionCatalog(): ProviderSelectionCatalogState {
  const [catalog, setCatalog] = useState<ProviderSelectionCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const value = await requestProviderSelectionCatalog(reloadToken > 0);
        if (cancelled) {
          return;
        }
        setCatalog(value);
        setError(null);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Failed to load providers.');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    const invalidate = () => setReloadToken((token) => token + 1);
    invalidationListeners.add(invalidate);
    authListenerSubscribers += 1;
    if (authListenerSubscribers === 1 && typeof window !== 'undefined') {
      window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, invalidateProviderSelectionCatalog);
      window.addEventListener('provider-profiles-updated', invalidateProviderSelectionCatalog);
      window.addEventListener('provider-auth-status-invalidated', invalidateProviderSelectionCatalog);
    }
    return () => {
      invalidationListeners.delete(invalidate);
      authListenerSubscribers = Math.max(0, authListenerSubscribers - 1);
      if (authListenerSubscribers === 0 && typeof window !== 'undefined') {
        window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, invalidateProviderSelectionCatalog);
        window.removeEventListener('provider-profiles-updated', invalidateProviderSelectionCatalog);
        window.removeEventListener('provider-auth-status-invalidated', invalidateProviderSelectionCatalog);
      }
    };
  }, []);

  const reload = useCallback(() => {
    invalidateProviderSelectionCatalog();
  }, []);

  const getEntry = useCallback(
    (provider: LLMProvider): ProviderSelectionCatalogEntry | null =>
      catalog?.providers.find((entry) => entry.provider === provider) ?? null,
    [catalog],
  );

  const listAvailable = useCallback(
    (): ProviderSelectionCatalogEntry[] =>
      (catalog?.providers ?? []).filter((entry) => entry.available),
    [catalog],
  );

  return { catalog, loading, error, reload, getEntry, listAvailable };
}

/**
 * Whether a (provider, profileId) pair exists in one catalog entry. Profile
 * identity is the pair, never the bare numeric id — Claude and Codex ids may
 * be numerically equal while referring to different profiles.
 */
export function catalogHasProfile(
  entry: ProviderSelectionCatalogEntry | null,
  profileId: number | null,
): boolean {
  if (!entry) {
    return false;
  }
  if (profileId === null) {
    return !isProfileProvider(entry.provider);
  }
  return entry.profiles.some((profile) => profile.id === profileId);
}

/**
 * The default profile of one provider entry: its flagged default when active,
 * otherwise the first listed profile, otherwise null.
 */
export function defaultProfileForEntry(
  entry: ProviderSelectionCatalogEntry | null,
): ProviderSelectionCatalogProfile | null {
  if (!entry || !isProfileProvider(entry.provider)) {
    return null;
  }
  return entry.profiles.find((profile) => profile.isDefault) ?? entry.profiles[0] ?? null;
}

/**
 * Validates a full selection against the catalog. Returns null when the
 * selection can be used to create/fork a session as-is, or a human-readable
 * reason string when it cannot.
 */
export function validateCatalogSelection(
  catalog: ProviderSelectionCatalog | null,
  selection: { provider: LLMProvider; providerProfileId: number | null; model: string },
): string | null {
  const entry = catalog?.providers.find((candidate) => candidate.provider === selection.provider) ?? null;
  if (!entry) {
    return `Provider "${selection.provider}" is unavailable.`;
  }
  if (!entry.available) {
    return entry.unavailableReason ?? `Provider "${selection.provider}" is unavailable.`;
  }
  if (!catalogHasProfile(entry, selection.providerProfileId)) {
    return isProfileProvider(entry.provider)
      ? 'The selected provider profile is no longer available.'
      : `Provider "${entry.provider}" does not use profiles.`;
  }
  if (!entry.models.OPTIONS.some((option) => option.value === selection.model)) {
    return `Model "${selection.model}" is not available for this provider.`;
  }
  return null;
}

/**
 * Resolves a valid fallback model for one provider: the requested model when
 * it still exists in the catalog, otherwise the catalog default. Returns null
 * when the provider entry is missing entirely.
 */
export function resolveCatalogModel(
  entry: ProviderSelectionCatalogEntry | null,
  requestedModel: string | null,
): string | null {
  if (!entry) {
    return null;
  }
  if (requestedModel && entry.models.OPTIONS.some((option) => option.value === requestedModel)) {
    return requestedModel;
  }
  return entry.models.DEFAULT || entry.models.OPTIONS[0]?.value || null;
}

/**
 * Picks the profile a selection should move to when its provider changes:
 * the previous profile is kept only when the provider did NOT change and the
 * catalog still lists it; otherwise the target provider's valid default.
 */
export function resolveProfileAfterProviderChange(
  catalog: ProviderSelectionCatalog | null,
  previousProvider: LLMProvider,
  previousProfileId: number | null,
  nextProvider: LLMProvider,
): number | null {
  const nextEntry = catalog?.providers.find((entry) => entry.provider === nextProvider) ?? null;
  if (!nextEntry || !nextEntry.available) {
    return null;
  }
  if (previousProvider === nextProvider && catalogHasProfile(nextEntry, previousProfileId)) {
    return previousProfileId;
  }
  return defaultProfileForEntry(nextEntry)?.id ?? null;
}

/**
 * A complete, catalog-valid selection for one provider, or null when the
 * provider cannot produce a valid selection right now (unavailable, or a
 * profile provider with no active profile). `preferredModel`/
 * `preferredProfileId` win when still valid; otherwise defaults are used.
 */
export function resolveValidSelection(
  catalog: ProviderSelectionCatalog | null,
  provider: LLMProvider,
  preferences?: { profileId?: number | null; model?: string | null },
): ResolvedProviderSelection | null {
  const entry = catalog?.providers.find((candidate) => candidate.provider === provider) ?? null;
  if (!entry || !entry.available) {
    return null;
  }

  if (isProfileProvider(provider)) {
    const preferredProfile = preferences?.profileId != null && entry.profiles.some((profile) => profile.id === preferences.profileId)
      ? preferences.profileId
      : defaultProfileForEntry(entry)?.id ?? null;
    if (preferredProfile == null) {
      return null;
    }
    const model = resolveCatalogModel(entry, preferences?.model ?? null);
    if (!model) {
      return null;
    }
    return { provider, providerProfileId: preferredProfile, model };
  }

  if (preferences?.profileId != null) {
    return null;
  }
  const model = resolveCatalogModel(entry, preferences?.model ?? null);
  if (!model) {
    return null;
  }
  return { provider, providerProfileId: null, model };
}

/** Model catalog of one provider, or an empty definition before load. */
export function catalogModelsFor(
  catalog: ProviderSelectionCatalog | null,
  provider: LLMProvider,
): ProviderModelsDefinition {
  const entry = catalog?.providers.find((candidate) => candidate.provider === provider);
  return entry?.models ?? { OPTIONS: [], DEFAULT: '' };
}
