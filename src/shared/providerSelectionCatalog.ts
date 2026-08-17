import type {
  LLMProvider,
  ProviderModelOption,
  ProviderSelectionCatalog,
  ProviderSelectionCatalogEntry,
  ProviderSelectionCatalogProfile,
} from '../types/app';

const PROVIDERS = new Set<LLMProvider>(['claude', 'codex', 'cursor', 'opencode']);
export const PROVIDER_SELECTION_PREFERENCE_EVENT = 'provider-selection-preference:changed';

let pendingCatalogSelection: {
  provider: LLMProvider;
  providerProfileId: number | null;
} | null = null;

/** Protects a freshly verified profile from reconciliation against a stale catalog snapshot. */
export function markDefaultProviderSelectionPendingCatalog(
  provider: LLMProvider,
  providerProfileId: number | null,
): void {
  pendingCatalogSelection = { provider, providerProfileId };
}

export function isDefaultProviderSelectionPendingCatalog(
  provider: LLMProvider,
  providerProfileId: number | null,
): boolean {
  return pendingCatalogSelection?.provider === provider
    && pendingCatalogSelection.providerProfileId === providerProfileId;
}

export function clearDefaultProviderSelectionPendingCatalog(): void {
  pendingCatalogSelection = null;
}

type StorageReader = Pick<Storage, 'getItem'>;

/** Makes a successful connection the default for new chats and mounted pickers. */
export function setDefaultProviderSelection(
  provider: LLMProvider,
  providerProfileId: number | null,
): void {
  persistDefaultProviderSelection(provider, providerProfileId);
  notifyDefaultProviderSelection(provider, providerProfileId);
}

/** Persists a verified new-chat preference without notifying stale mounted pickers. */
export function persistDefaultProviderSelection(
  provider: LLMProvider,
  providerProfileId: number | null,
): void {
  localStorage.setItem('selected-provider', provider);
  const profileKey = provider === 'claude'
    ? 'claude-provider-profile-id'
    : provider === 'codex'
      ? 'codex-provider-profile-id'
      : null;
  if (profileKey) {
    localStorage.setItem(profileKey, providerProfileId === null ? 'local' : String(providerProfileId));
  }
}

/** Notifies mounted Chat only after its catalog can validate the persisted selection. */
export function notifyDefaultProviderSelection(
  provider: LLMProvider,
  providerProfileId: number | null,
): void {
  window.dispatchEvent(new CustomEvent(PROVIDER_SELECTION_PREFERENCE_EVENT, {
    detail: { provider, providerProfileId },
  }));
}

/**
 * Reads the complete persisted provider/profile/model preference used by
 * provider-backed actions outside an existing Chat session.
 *
 * Invalid values are discarded locally and later reconciled only inside the
 * same provider through `resolveValidSelection`; this parser never switches to
 * another provider because one profile or model disappeared.
 */
export function readStoredProviderSelectionPreferences(
  storage?: StorageReader,
): {
  provider: LLMProvider;
  providerProfileId: number | null;
  model: string | null;
} {
  const source = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  const storedProvider = source?.getItem('selected-provider') ?? null;
  const provider = PROVIDERS.has(storedProvider as LLMProvider)
    ? storedProvider as LLMProvider
    : 'claude';
  const profileKey = provider === 'claude'
    ? 'claude-provider-profile-id'
    : provider === 'codex'
      ? 'codex-provider-profile-id'
      : null;
  const storedProfile = profileKey ? source?.getItem(profileKey) ?? null : null;
  const parsedProfile = storedProfile && /^\d+$/.test(storedProfile)
    ? Number(storedProfile)
    : NaN;
  const providerProfileId = profileKey && Number.isInteger(parsedProfile) && parsedProfile > 0
    ? parsedProfile
    : null;
  const storedModel = source?.getItem(`${provider}-model`)?.trim() ?? '';
  return {
    provider,
    providerProfileId,
    model: storedModel || null,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

function parseEffort(value: unknown): ProviderModelOption['effort'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !Array.isArray(value.values)) return undefined;
  if (value.default !== undefined && !isNonEmptyString(value.default)) return undefined;

  const values = value.values.map((candidate) => {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.value)) return null;
    if (candidate.description !== undefined && typeof candidate.description !== 'string') return null;
    return {
      value: candidate.value,
      ...(candidate.description === undefined ? {} : { description: candidate.description }),
    };
  });
  if (values.some((candidate) => candidate === null)) return undefined;
  if (
    value.default !== undefined
    && !values.some((candidate) => candidate?.value === value.default)
  ) {
    return undefined;
  }

  return {
    ...(value.default === undefined ? {} : { default: value.default as string }),
    values: values as NonNullable<ProviderModelOption['effort']>['values'],
  };
}

function parseModelOption(value: unknown): ProviderModelOption | null {
  if (!isRecord(value) || !isNonEmptyString(value.value) || !isNonEmptyString(value.label)) {
    return null;
  }
  if (value.description !== undefined && typeof value.description !== 'string') return null;
  const effort = parseEffort(value.effort);
  if (value.effort !== undefined && !effort) return null;

  return {
    value: value.value,
    label: value.label,
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(effort === undefined ? {} : { effort }),
  };
}

function parseProfile(value: unknown): ProviderSelectionCatalogProfile | null {
  if (
    !isRecord(value)
    || !Number.isInteger(value.id)
    || (value.id as number) <= 0
    || !isNonEmptyString(value.title)
    || typeof value.isDefault !== 'boolean'
  ) {
    return null;
  }
  return { id: value.id as number, title: value.title, isDefault: value.isDefault };
}

function parseEntry(value: unknown): ProviderSelectionCatalogEntry | null {
  if (
    !isRecord(value)
    || !PROVIDERS.has(value.provider as LLMProvider)
    || typeof value.available !== 'boolean'
    || typeof value.connectionAvailable !== 'boolean'
    || (value.unavailableReason !== null && typeof value.unavailableReason !== 'string')
    || !Array.isArray(value.profiles)
    || !isRecord(value.models)
    || !Array.isArray(value.models.OPTIONS)
    || !isNonEmptyString(value.models.DEFAULT)
  ) {
    return null;
  }

  const profiles = value.profiles.map(parseProfile);
  const options = value.models.OPTIONS.map(parseModelOption);
  if (profiles.some((profile) => profile === null) || options.some((option) => option === null)) {
    return null;
  }

  const modelValues = new Set(options.map((option) => option?.value));
  if (modelValues.size !== options.length || !modelValues.has(value.models.DEFAULT)) return null;
  const profileIds = new Set(profiles.map((profile) => profile?.id));
  if (profileIds.size !== profiles.length) return null;

  return {
    provider: value.provider as LLMProvider,
    available: value.available,
    connectionAvailable: value.connectionAvailable,
    unavailableReason: value.unavailableReason as string | null,
    profiles: profiles as ProviderSelectionCatalogProfile[],
    models: {
      OPTIONS: options as ProviderModelOption[],
      DEFAULT: value.models.DEFAULT,
    },
  };
}

function parseCatalog(value: unknown): ProviderSelectionCatalog | null {
  if (!isRecord(value) || !Array.isArray(value.providers)) return null;
  const providers = value.providers.map(parseEntry);
  if (providers.some((entry) => entry === null)) return null;
  const providerIds = new Set(providers.map((entry) => entry?.provider));
  if (providerIds.size !== providers.length) return null;
  return { providers: providers as ProviderSelectionCatalogEntry[] };
}

function isJsonCompatibleContentType(contentType: string | null): boolean {
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

function readApiErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.message === 'string' && value.message.trim()) return value.message;
  if (typeof value.error === 'string' && value.error.trim()) return value.error;
  if (isRecord(value.error) && typeof value.error.message === 'string' && value.error.message.trim()) {
    return value.error.message;
  }
  return null;
}

/** Gives Chat one stable explanation for an idle Send disabled by catalog failure. */
export function getProviderCatalogSendBlockReason(
  catalogError: string | null,
  isRunning: boolean,
): string | null {
  if (!catalogError || isRunning) return null;
  return 'Providers are unavailable. Retry the catalog or open Agent Settings before sending.';
}

/** Shared gate used by form, keyboard, queued, and voice submission paths. */
export function isChatSubmissionBlocked(reason: string | null | undefined): boolean {
  return Boolean(reason);
}

/** Retry is primary only while Chat is idle; running Chat reserves primary emphasis for Stop. */
export function getProviderCatalogRetryEmphasis(
  catalogError: string | null,
  isRunning: boolean,
): 'primary' | 'neutral' | null {
  if (!catalogError) return null;
  return isRunning ? 'neutral' : 'primary';
}

/**
 * Decodes the provider catalog transport shared by Chat and task workflows.
 * It rejects non-JSON/status failures and malformed nested data with stable,
 * user-safe messages so HTML proxy errors never surface as JSON parser text.
 */
export async function decodeProviderSelectionCatalogResponse(
  response: Response,
): Promise<ProviderSelectionCatalog> {
  const statusFailure = !response.ok;
  if (!isJsonCompatibleContentType(response.headers.get('content-type'))) {
    throw new Error(statusFailure
      ? `Provider catalog request failed (${response.status}).`
      : 'Provider catalog returned an unsupported response.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(statusFailure
      ? `Provider catalog request failed (${response.status}).`
      : 'Provider catalog returned invalid JSON.');
  }

  const errorMessage = readApiErrorMessage(payload);
  if (statusFailure || (isRecord(payload) && payload.success === false)) {
    throw new Error(errorMessage || `Provider catalog request failed (${response.status}).`);
  }
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error('Provider catalog response has an invalid schema.');
  }

  const catalog = parseCatalog(payload.data);
  if (!catalog) {
    throw new Error('Provider catalog response has an invalid schema.');
  }
  return catalog;
}
