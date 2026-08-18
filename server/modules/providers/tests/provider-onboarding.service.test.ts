import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderOnboardingService } from '@/modules/providers/services/provider-onboarding.service.js';
import type {
  ProviderProfileAuthType,
  ProviderProfileProvider,
  ProviderProfilePublic,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

function publicProfile(
  provider: ProviderProfileProvider,
  title = 'Default Main',
  baseUrl: string | null = provider === 'codex' ? 'https://api.openai.com/v1' : null,
): ProviderProfilePublic {
  return {
    id: 7,
    provider,
    title,
    baseUrl,
    authType: 'api_key',
    isDefault: true,
    isActive: true,
    hasSecret: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

test('verifies Claude against a custom Base URL before storing the titled write-only profile', async () => {
  const fetches: Array<{ url: string; init?: RequestInit }> = [];
  const writes: Array<{
    userId: number;
    provider: ProviderProfileProvider;
    input: {
      title: string;
      baseUrl: string | null;
      authType: ProviderProfileAuthType;
      secretValue: string;
    };
  }> = [];
  const service = createProviderOnboardingService({
    runtimeMode: 'desktop-local',
    fetchFn: async (input, init) => {
      fetches.push({ url: String(input), init });
      return new Response('{}', { status: 200 });
    },
    profiles: {
      upsertDefaultProviderProfile(userId, provider, input) {
        writes.push({ userId, provider, input });
        return publicProfile(provider, input.title, input.baseUrl);
      },
    },
  });

  const profile = await service.connectToken({
    userId: 12,
    provider: 'claude',
    token: 'sk-ant-api-secret',
    title: 'Work Gateway',
    baseUrl: 'https://gateway.example/anthropic/',
  });

  assert.equal(fetches[0]?.url, 'https://gateway.example/anthropic/v1/models?limit=1');
  assert.equal(new Headers(fetches[0]?.init?.headers).get('x-api-key'), 'sk-ant-api-secret');
  assert.deepEqual(writes, [{
    userId: 12,
    provider: 'claude',
    input: {
      title: 'Work Gateway',
      baseUrl: 'https://gateway.example/anthropic',
      authType: 'api_key',
      secretValue: 'sk-ant-api-secret',
    },
  }]);
  assert.equal(profile.title, 'Work Gateway');
  assert.equal('secretValue' in profile, false);
});

test('uses the official Codex API profile after bearer verification', async () => {
  let write: unknown;
  const service = createProviderOnboardingService({
    runtimeMode: 'desktop-local',
    fetchFn: async (input, init) => {
      assert.equal(String(input), 'https://api.openai.com/v1/models');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer codex-secret');
      return new Response('{}', { status: 200 });
    },
    profiles: {
      upsertDefaultProviderProfile(userId, provider, input) {
        write = { userId, provider, input };
        return publicProfile(provider);
      },
    },
  });

  await service.connectToken({
    userId: 3,
    provider: 'codex',
    token: 'codex-secret',
    title: '',
    baseUrl: null,
  });
  assert.deepEqual(write, {
    userId: 3,
    provider: 'codex',
    input: {
      title: 'Default Main',
      baseUrl: 'https://api.openai.com/v1',
      authType: 'api_key',
      secretValue: 'codex-secret',
    },
  });
});

test('invalid and unavailable verification never writes a profile or echoes the token', async () => {
  let writes = 0;
  const createService = (fetchFn: typeof fetch) => createProviderOnboardingService({
    runtimeMode: 'desktop-local',
    fetchFn,
    profiles: {
      upsertDefaultProviderProfile() {
        writes += 1;
        return publicProfile('claude');
      },
    },
  });

  const secret = 'never-echo-this-secret';
  await assert.rejects(
    createService(async () => new Response('{}', { status: 401 })).connectToken({
      userId: 1,
      provider: 'claude',
      token: secret,
    }),
    (error: unknown) => error instanceof AppError
      && error.code === 'INVALID_PROVIDER_TOKEN'
      && !error.message.includes(secret),
  );
  await assert.rejects(
    createService(async () => { throw new Error(`network failed near ${secret}`); }).connectToken({
      userId: 1,
      provider: 'codex',
      token: secret,
    }),
    (error: unknown) => error instanceof AppError
      && error.code === 'PROVIDER_VERIFICATION_UNAVAILABLE'
      && !error.message.includes(secret),
  );
  assert.equal(writes, 0);
});

test('rejects token onboarding outside Desktop local without verification or persistence', async () => {
  let fetches = 0;
  let writes = 0;
  const service = createProviderOnboardingService({
    runtimeMode: 'standalone-web',
    fetchFn: async () => {
      fetches += 1;
      return new Response('{}', { status: 200 });
    },
    profiles: {
      upsertDefaultProviderProfile() {
        writes += 1;
        return publicProfile('claude');
      },
    },
  });

  await assert.rejects(
    service.connectToken({ userId: 1, provider: 'claude', token: 'secret' }),
    (error: unknown) => error instanceof AppError
      && error.code === 'DESKTOP_PROVIDER_ONBOARDING_UNAVAILABLE'
      && error.statusCode === 404,
  );
  assert.equal(fetches, 0);
  assert.equal(writes, 0);
});
