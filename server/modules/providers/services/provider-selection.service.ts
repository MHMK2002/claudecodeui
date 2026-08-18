import { providerProfilesDb, sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import type {
  LLMProvider,
  ProviderModelsDefinition,
  ProviderProfileProvider,
  ProviderProfilePublic,
  ProviderSelectionCatalog,
  ProviderSelectionCatalogEntry,
  ProviderSelectionCatalogProfile,
  ProviderTextCompletionSelection,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** Providers whose execution requires a user-managed provider profile. */
const PROFILE_PROVIDERS: readonly ProviderProfileProvider[] = ['claude', 'codex'];
const LOW_TOKEN_EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Auth + registry surface the service needs, narrowed so tests can stub it. */
type SelectionProviderAuth = {
  getStatus(): Promise<{ installed: boolean; authenticated: boolean; error?: string }>;
};

type ProviderSelectionServiceDependencies = {
  listProviders?: () => Array<{ id: LLMProvider; auth: SelectionProviderAuth }>;
  resolveProvider?: (provider: LLMProvider) => { auth: SelectionProviderAuth };
  getProviderModels?: (
    provider: LLMProvider,
  ) => Promise<{ models: ProviderModelsDefinition }>;
  getProviderAuthStatus?: (provider: LLMProvider) => Promise<{
    installed: boolean;
    authenticated: boolean;
    error?: string;
  }>;
  profiles?: {
    listProviderProfiles(
      userId: number,
      provider: ProviderProfileProvider,
    ): ProviderProfilePublic[];
    getProviderProfileForRuntime(
      userId: number,
      provider: ProviderProfileProvider,
      profileId: number,
    ): ProviderProfilePublic | null;
  };
  sessions?: {
    getSessionById(sessionId: string): {
      provider: string;
      provider_profile_id: number | null;
      model?: string | null;
    } | null;
    bindProviderProfileIfUnassigned(
      sessionId: string,
      provider: ProviderProfileProvider,
      providerProfileId: number,
    ): number | null;
  };
};

function isProfileProvider(provider: LLMProvider): provider is ProviderProfileProvider {
  return PROFILE_PROVIDERS.includes(provider as ProviderProfileProvider);
}

/**
 * Projects one persisted profile into its public catalog shape.
 *
 * Deliberately drops every credential-bearing field (baseUrl, authType,
 * hasSecret, timestamps): the catalog is rendered in pickers and must never
 * carry auth payload.
 */
function toCatalogProfile(profile: ProviderProfilePublic): ProviderSelectionCatalogProfile {
  return {
    id: profile.id,
    title: profile.title,
    isDefault: profile.isDefault,
  };
}

/**
 * Builds the provider-selection application service.
 *
 * Single Settings-backed source of truth for what can be selected and what can
 * run. The providers routes, the session-gateway routes, and the chat websocket
 * all validate through this service instead of re-implementing profile and
 * connection checks, so the catalog and the enforcement can never drift apart.
 *
 * Consumers: provider.routes.ts (catalog endpoint + session create/fork
 * validation), chat-websocket.service.ts (pre-run execution validation).
 */
export const createProviderSelectionService = (
  dependencies: ProviderSelectionServiceDependencies = {},
) => {
  const listProviders = dependencies.listProviders ?? providerRegistry.listProviders;
  const resolveProvider = dependencies.resolveProvider ?? providerRegistry.resolveProvider;
  const getProviderModels = dependencies.getProviderModels
    ?? (async (provider: LLMProvider) => providerModelsService.getProviderModels(provider));
  const profiles = dependencies.profiles ?? providerProfilesDb;
  const sessions = dependencies.sessions ?? sessionsDb;
  const getProviderAuthStatus = dependencies.getProviderAuthStatus
    ?? ((dependencies.listProviders || dependencies.resolveProvider)
      ? async (provider: LLMProvider) => resolveProvider(provider).auth.getStatus()
      : async (provider: LLMProvider) => providerAuthService.getProviderAuthStatus(provider));

  const readConnectionStatus = async (provider: LLMProvider) => {
    try {
      return await getProviderAuthStatus(provider);
    } catch {
      return {
        installed: false,
        authenticated: false,
        error: 'Provider status could not be checked. Try again from Settings.',
      };
    }
  };

  const requireConnection = async (provider: LLMProvider): Promise<void> => {
    const status = await readConnectionStatus(provider);
    if (!status.installed || !status.authenticated) {
      throw new AppError(
        status.error ?? `Provider "${provider}" is not connected.`,
        { code: 'PROVIDER_NOT_CONNECTED', statusCode: 400 },
      );
    }
  };

  return {
    /**
     * Builds the public selection catalog for one user.
     *
     * Only public data is returned: provider availability, active profiles
     * (id/title/isDefault), and the provider-level model catalog. No tokens,
     * secrets, credential paths, or auth payloads ever appear here.
     *
     * Unavailable providers are still listed (with a reason) so pickers can
     * explain why an entry is disabled instead of hiding it.
     */
    async getPublicSelectionCatalog(userId: number): Promise<ProviderSelectionCatalog> {
      const providers: ProviderSelectionCatalogEntry[] = await Promise.all(
        listProviders().map(async (provider) => {
          const models = (await getProviderModels(provider.id)).models;
          const status = await readConnectionStatus(provider.id);
          const connectionAvailable = status.installed && status.authenticated;

          if (isProfileProvider(provider.id)) {
            const profileList = profiles
              .listProviderProfiles(userId, provider.id)
              .filter((profile) => profile.isActive)
              .map(toCatalogProfile);
            const available = connectionAvailable || profileList.length > 0;
            return {
              provider: provider.id,
              available,
              connectionAvailable,
              unavailableReason: available
                ? null
                : status.error
                  ?? `Connect ${provider.id === 'claude' ? 'Claude' : 'Codex'} or add an active provider profile.`,
              profiles: profileList,
              models,
            };
          }

          // Cursor/OpenCode have no profiles; availability is the live local
          // connection (CLI installed and authenticated).
          return {
            provider: provider.id,
            available: connectionAvailable,
            connectionAvailable,
            unavailableReason: connectionAvailable ? null : status.error ?? 'Provider is not connected.',
            profiles: [],
            models,
          };
        }),
      );

      return { providers };
    },

    /**
     * Resolves the low-token default used before a user saves Generator settings.
     *
     * The first available catalog provider is chosen only for a missing setting;
     * an existing invalid setting is never reconciled across providers.
     */
    async resolveDefaultTextCompletionSelection(
      userId: number,
    ): Promise<ProviderTextCompletionSelection | null> {
      const catalog = await this.getPublicSelectionCatalog(userId);
      for (const entry of catalog.providers) {
        if (!entry.available) continue;
        const providerProfileId = isProfileProvider(entry.provider)
          ? (entry.profiles.find((profile) => profile.isDefault) ?? entry.profiles[0])?.id ?? null
          : null;
        if (
          isProfileProvider(entry.provider)
          && providerProfileId === null
          && !entry.connectionAvailable
        ) continue;
        const modelOption = entry.models.OPTIONS.find(
          (option) => option.value === entry.models.DEFAULT,
        ) ?? entry.models.OPTIONS[0];
        if (!modelOption) continue;
        const effortValues = modelOption.effort?.values.map((effort) => effort.value) ?? [];
        const effort = LOW_TOKEN_EFFORT_ORDER.find((candidate) => effortValues.includes(candidate))
          ?? modelOption.effort?.default
          ?? effortValues[0]
          ?? null;
        return {
          provider: entry.provider,
          providerProfileId,
          model: modelOption.value,
          effort,
        };
      }
      return null;
    },

    /**
     * Validates one full selection (provider + optional profile + model) against
     * the catalog before anything is created or run.
     *
     * Rules:
     * - Claude/Codex: a positive id must resolve to an active owned profile; a
     *   null id uses the authenticated local CLI connection.
     * - Cursor/OpenCode: the live connection must be valid and profile id null.
     * - The model must exist in that provider's model catalog.
     *
     * Throws AppError (400/401/404) on the first violated rule.
     */
    async validateSelection(input: {
      userId: number;
      provider: LLMProvider;
      providerProfileId: number | null;
      model: string;
      effort?: string | null;
    }): Promise<void> {
      const { userId, provider, providerProfileId, model } = input;

      if (!model.trim()) {
        throw new AppError('model is required.', {
          code: 'MODEL_REQUIRED',
          statusCode: 400,
        });
      }

      if (isProfileProvider(provider)) {
        if (providerProfileId === null) {
          await requireConnection(provider);
        } else {
          const profile = profiles.getProviderProfileForRuntime(
            userId,
            provider,
            providerProfileId,
          );
          if (!profile) {
            throw new AppError('Provider profile not found or inactive.', {
              code: 'PROVIDER_PROFILE_NOT_FOUND',
              statusCode: 404,
            });
          }
        }
      } else {
        if (providerProfileId !== null) {
          throw new AppError(
            `providerProfileId is not supported for provider "${provider}"; it must be null.`,
            { code: 'PROVIDER_PROFILE_UNSUPPORTED', statusCode: 400 },
          );
        }

        await requireConnection(provider);
      }

      await this.validateProviderModel(provider, model, input.effort);
    },

    /**
     * Validates that one model exists in the provider's model catalog.
     *
     * Shared by `validateSelection` and any caller that only needs the model half
     * of the contract (e.g. a fork that re-validates the target model).
     */
    async validateProviderModel(
      provider: LLMProvider,
      model: string,
      effort?: string | null,
    ): Promise<void> {
      const models: ProviderModelsDefinition = (await getProviderModels(provider)).models;
      const modelOption = models.OPTIONS.find((option) => option.value === model);
      if (!modelOption) {
        throw new AppError(`Model "${model}" is not available for provider "${provider}".`, {
          code: 'MODEL_NOT_AVAILABLE',
          statusCode: 400,
        });
      }
      if (effort === undefined) return;

      const effortValues = modelOption.effort?.values.map((entry) => entry.value) ?? [];
      if (effortValues.length === 0 && effort !== null) {
        throw new AppError(`Model "${model}" does not support reasoning effort.`, {
          code: 'EFFORT_UNSUPPORTED',
          statusCode: 400,
        });
      }
      if (effortValues.length > 0 && effort === null) {
        throw new AppError(`Reasoning effort is required for model "${model}".`, {
          code: 'EFFORT_REQUIRED',
          statusCode: 400,
        });
      }
      if (effort !== null && !effortValues.includes(effort)) {
        throw new AppError(
          `Reasoning effort "${effort}" is not available for model "${model}".`,
          { code: 'EFFORT_NOT_AVAILABLE', statusCode: 400 },
        );
      }
    },

    /**
     * Re-validates one existing session's execution right before its message is
     * run — called by the chat gateway before fork context is consumed and before
     * the run is registered, so an invalid selection costs nothing.
     *
     * Profile-less sessions run only while that provider's local CLI connection
     * is authenticated. Profile sessions still require an active owned profile.
     */
    async validateSessionExecution(input: {
      userId: number | null;
      sessionId: string;
    }): Promise<number | null> {
      const session = sessions.getSessionById(input.sessionId);
      if (!session) {
        throw new AppError(`Session "${input.sessionId}" was not found.`, {
          code: 'SESSION_NOT_FOUND',
          statusCode: 404,
        });
      }

      const provider = session.provider as LLMProvider;
      const providerProfileId = session.provider_profile_id ?? null;

      if (!isProfileProvider(provider)) {
        if (providerProfileId !== null) {
          throw new AppError('This session has an unsupported provider profile.', {
            code: 'PROVIDER_PROFILE_UNSUPPORTED',
            statusCode: 400,
          });
        }

        const status = await getProviderAuthStatus(provider);
        if (!status.installed || !status.authenticated) {
          throw new AppError(
            status.error ?? `Provider "${provider}" is not connected.`,
            { code: 'PROVIDER_NOT_CONNECTED', statusCode: 400 },
          );
        }
        return null;
      }

      if (providerProfileId === null) {
        const status = await readConnectionStatus(provider);
        if (status.installed && status.authenticated) {
          return null;
        }
        if (input.userId === null) {
          throw new AppError(
            `A signed-in user is required to use a stored ${provider} provider profile.`,
            { code: 'PROVIDER_PROFILE_AUTH_REQUIRED', statusCode: 401 },
          );
        }

        const activeProfiles = profiles
          .listProviderProfiles(input.userId, provider)
          .filter((profile) => profile.isActive);
        const fallbackProfile = activeProfiles.find((profile) => profile.isDefault)
          ?? activeProfiles[0]
          ?? null;
        if (!fallbackProfile) {
          throw new AppError(
            status.error
              ?? `Connect ${provider === 'claude' ? 'Claude' : 'Codex'} or add an active provider profile.`,
            { code: 'PROVIDER_NOT_CONNECTED', statusCode: 400 },
          );
        }

        const boundProfileId = sessions.bindProviderProfileIfUnassigned(
          input.sessionId,
          provider,
          fallbackProfile.id,
        );
        if (boundProfileId === null) {
          throw new AppError(`Session "${input.sessionId}" was not found.`, {
            code: 'SESSION_NOT_FOUND',
            statusCode: 404,
          });
        }
        const boundProfile = profiles.getProviderProfileForRuntime(
          input.userId,
          provider,
          boundProfileId,
        );
        if (!boundProfile) {
          throw new AppError(
            'The provider profile for this session was not found or is inactive.',
            { code: 'PROVIDER_PROFILE_NOT_FOUND', statusCode: 404 },
          );
        }
        return boundProfileId;
      }

      if (input.userId === null) {
        throw new AppError(
          `A signed-in user is required to use this ${provider} provider profile.`,
          { code: 'PROVIDER_PROFILE_AUTH_REQUIRED', statusCode: 401 },
        );
      }

      const profile = profiles.getProviderProfileForRuntime(
        input.userId,
        provider,
        providerProfileId,
      );
      if (!profile) {
        throw new AppError(
          'The provider profile for this session was not found or is inactive. Fork it with a valid provider profile to continue.',
          { code: 'PROVIDER_PROFILE_NOT_FOUND', statusCode: 404 },
        );
      }
      return providerProfileId;
    },

    /**
     * Reads one session's stored provider/profile/model triple for callers that
     * need the session's own selection (e.g. the fork dialog preselection).
     *
     * Consumers: provider.routes.ts fork flow.
     */
    getSessionSelection(sessionId: string): {
      provider: LLMProvider;
      providerProfileId: number | null;
      model: string | null;
    } {
      const session = sessions.getSessionById(sessionId);
      if (!session) {
        throw new AppError(`Session "${sessionId}" was not found.`, {
          code: 'SESSION_NOT_FOUND',
          statusCode: 404,
        });
      }
      return {
        provider: session.provider as LLMProvider,
        providerProfileId: session.provider_profile_id ?? null,
        model: session.model?.trim() || null,
      };
    },
  };
};

/**
 * Application-singleton provider-selection service.
 *
 * Used by provider.routes.ts (catalog + session create/fork validation) and
 * chat-websocket.service.ts (pre-run execution validation).
 */
export const providerSelectionService = createProviderSelectionService();
