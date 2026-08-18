import { providerProfilesDb } from '@/modules/database/index.js';
import type {
  ProviderProfileAuthType,
  ProviderProfileProvider,
  ProviderProfilePublic,
  RuntimeMode,
} from '@/shared/types.js';
import {
  AppError,
  buildProviderTokenVerificationUrl,
  normalizeProviderBaseUrl,
  RUNTIME_MODE,
} from '@/shared/utils.js';

const VERIFY_TIMEOUT_MS = 10_000;

type ProviderOnboardingDependencies = {
  fetchFn?: typeof fetch;
  runtimeMode?: RuntimeMode;
  timeoutMs?: number;
  profiles?: {
    upsertDefaultProviderProfile(
      userId: number,
      provider: ProviderProfileProvider,
      input: {
        title: string;
        baseUrl: string | null;
        authType: ProviderProfileAuthType;
        secretValue: string;
      },
    ): ProviderProfilePublic;
  };
};

function verificationRequest(
  provider: ProviderProfileProvider,
  token: string,
  baseUrl: string | null,
): {
  url: string;
  headers: Record<string, string>;
  profile: { baseUrl: string | null; authType: ProviderProfileAuthType };
} {
  if (provider === 'codex') {
    const effectiveBaseUrl = baseUrl ?? 'https://api.openai.com/v1';
    return {
      url: buildProviderTokenVerificationUrl(provider, effectiveBaseUrl),
      headers: { Authorization: `Bearer ${token}` },
      profile: { baseUrl: effectiveBaseUrl, authType: 'api_key' },
    };
  }

  const authType: ProviderProfileAuthType = token.startsWith('sk-ant-api')
    ? 'api_key'
    : 'auth_token';
  return {
    url: buildProviderTokenVerificationUrl(provider, baseUrl),
    headers: {
      'anthropic-version': '2023-06-01',
      ...(authType === 'api_key'
        ? { 'x-api-key': token }
        : {
            Authorization: `Bearer ${token}`,
            'anthropic-beta': 'oauth-2025-04-20',
          }),
    },
    profile: { baseUrl, authType },
  };
}

/**
 * Builds the token-verification service used by provider routes and focused
 * provider tests. Persistence happens only after a successful live check.
 */
export function createProviderOnboardingService(
  dependencies: ProviderOnboardingDependencies = {},
) {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const runtimeMode = dependencies.runtimeMode ?? RUNTIME_MODE;
  const timeoutMs = dependencies.timeoutMs ?? VERIFY_TIMEOUT_MS;
  const profiles = dependencies.profiles ?? providerProfilesDb;

  return {
    async connectToken(input: {
      userId: number;
      provider: ProviderProfileProvider;
      token: string;
      title?: string;
      baseUrl?: string | null;
    }): Promise<ProviderProfilePublic> {
      if (runtimeMode !== 'desktop-local') {
        throw new AppError('First-run provider token setup is available only in Desktop local mode.', {
          code: 'DESKTOP_PROVIDER_ONBOARDING_UNAVAILABLE',
          statusCode: 404,
        });
      }
      const token = input.token.trim();
      if (!token) {
        throw new AppError('token is required.', {
          code: 'PROVIDER_TOKEN_REQUIRED',
          statusCode: 400,
        });
      }

      const title = input.title?.trim() || 'Default Main';
      const baseUrl = normalizeProviderBaseUrl(input.baseUrl);
      const request = verificationRequest(input.provider, token, baseUrl);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(request.url, {
          method: 'GET',
          headers: request.headers,
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          throw new AppError('The provider rejected this token.', {
            code: 'INVALID_PROVIDER_TOKEN',
            statusCode: 400,
          });
        }
        if (!response.ok) {
          throw new AppError('The provider could not verify this token. Try again.', {
            code: 'PROVIDER_VERIFICATION_UNAVAILABLE',
            statusCode: 503,
          });
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError('The provider could not be reached. Check your connection and retry.', {
          code: 'PROVIDER_VERIFICATION_UNAVAILABLE',
          statusCode: 503,
        });
      } finally {
        clearTimeout(timer);
      }

      return profiles.upsertDefaultProviderProfile(input.userId, input.provider, {
        title,
        ...request.profile,
        secretValue: token,
      });
    },
  };
}

/** Provider routes use this singleton for verified first-run token setup. */
export const providerOnboardingService = createProviderOnboardingService();
