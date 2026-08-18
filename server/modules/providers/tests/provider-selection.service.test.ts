import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderSelectionService } from '@/modules/providers/services/provider-selection.service.js';
import type {
  LLMProvider,
  ProviderProfileProvider,
  ProviderProfilePublic,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type AuthState = { installed: boolean; authenticated: boolean; error?: string };

type Harness = {
  service: ReturnType<typeof createProviderSelectionService>;
  authStates: Record<LLMProvider, AuthState>;
  modelsByProvider: Record<string, string[]>;
  profilesByProvider: Record<string, ProviderProfilePublic[]>;
  runtimeProfiles: Record<string, ProviderProfilePublic[]>;
  sessions: Map<string, { provider: string; provider_profile_id: number | null; model?: string | null }>;
};

function createProfile(
  provider: ProviderProfileProvider,
  id: number,
  overrides: Partial<ProviderProfilePublic> = {},
): ProviderProfilePublic {
  return {
    id,
    provider,
    title: `Profile ${id}`,
    baseUrl: null,
    authType: 'auth_token',
    isDefault: id === 1,
    isActive: true,
    hasSecret: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createHarness(): Harness {
  const authStates: Record<LLMProvider, AuthState> = {
    claude: { installed: true, authenticated: false },
    codex: { installed: true, authenticated: false },
    cursor: { installed: true, authenticated: true },
    opencode: { installed: true, authenticated: true },
  };
  const modelsByProvider: Record<string, string[]> = {
    claude: ['claude-sonnet', 'claude-opus'],
    codex: ['gpt-5'],
    cursor: ['cursor-fast'],
    opencode: ['opencode-default'],
  };
  const claudeProfiles = [
    createProfile('claude', 1),
    createProfile('claude', 2, { isDefault: false }),
  ];
  const codexProfiles = [createProfile('codex', 1)];
  const profilesByProvider: Record<string, ProviderProfilePublic[]> = {
    claude: claudeProfiles,
    codex: codexProfiles,
  };
  // Runtime lookups (validation) may differ from listing (catalog).
  const runtimeProfiles: Record<string, ProviderProfilePublic[]> = {
    claude: [...claudeProfiles],
    codex: [...codexProfiles],
  };
  const sessions = new Map<string, { provider: string; provider_profile_id: number | null; model?: string | null }>();

  const listProviders = () => (['claude', 'codex', 'cursor', 'opencode'] as LLMProvider[])
    .map((id) => ({ id, auth: { getStatus: async () => authStates[id] } }));

  const service = createProviderSelectionService({
    listProviders,
    resolveProvider: (provider) => {
      const entry = listProviders().find((candidate) => candidate.id === provider);
      if (!entry) {
        throw new Error(`Missing provider: ${provider}`);
      }
      return entry;
    },
    getProviderModels: async (provider) => ({
      models: {
        OPTIONS: (modelsByProvider[provider] ?? []).map((value) => ({
          value,
          label: value,
          ...(value === 'claude-sonnet' || value === 'gpt-5'
            ? {
                effort: {
                  default: 'high',
                  values: [{ value: 'low' }, { value: 'high' }],
                },
              }
            : {}),
        })),
        DEFAULT: (modelsByProvider[provider] ?? [])[0] ?? 'default',
      },
    }),
    profiles: {
      listProviderProfiles: (_userId, provider) => profilesByProvider[provider] ?? [],
      getProviderProfileForRuntime: (_userId, provider, profileId) =>
        (runtimeProfiles[provider] ?? []).find((profile) => profile.id === profileId) ?? null,
    },
    sessions: {
      getSessionById: (sessionId) => sessions.get(sessionId) ?? null,
      bindProviderProfileIfUnassigned: (sessionId, provider, profileId) => {
        const session = sessions.get(sessionId);
        if (!session || session.provider !== provider) return null;
        if (session.provider_profile_id === null) session.provider_profile_id = profileId;
        return session.provider_profile_id;
      },
    },
  });

  return { service, authStates, modelsByProvider, profilesByProvider, runtimeProfiles, sessions };
}

const expectAppError = (code: string) => (error: unknown): boolean =>
  error instanceof AppError && error.code === code;

test('catalog returns only public data: profiles without credential fields, no secrets', async () => {
  const { service } = createHarness();
  const catalog = await service.getPublicSelectionCatalog(1);

  const claudeEntry = catalog.providers.find((entry) => entry.provider === 'claude');
  assert.ok(claudeEntry);
  assert.equal(claudeEntry.available, true);
  assert.equal(claudeEntry.connectionAvailable, false);
  assert.deepEqual(
    claudeEntry.profiles.map((profile) => ({ ...profile })),
    [
      { id: 1, title: 'Profile 1', isDefault: true },
      { id: 2, title: 'Profile 2', isDefault: false },
    ],
  );
  // No credential-bearing field may exist on any catalog profile.
  for (const entry of catalog.providers) {
    for (const profile of entry.profiles) {
      assert.equal('baseUrl' in profile, false);
      assert.equal('authType' in profile, false);
      assert.equal('hasSecret' in profile, false);
    }
  }
  // Models are provider-level.
  assert.deepEqual(
    claudeEntry.models.OPTIONS.map((option) => option.value),
    ['claude-sonnet', 'claude-opus'],
  );
});

test('catalog marks Claude/Codex unavailable when they have no active profiles', async () => {
  const { service, profilesByProvider } = createHarness();
  profilesByProvider.claude = [];
  profilesByProvider.codex = [
    createProfile('codex', 1, { isActive: false }),
  ];

  const catalog = await service.getPublicSelectionCatalog(1);
  const claudeEntry = catalog.providers.find((entry) => entry.provider === 'claude');
  const codexEntry = catalog.providers.find((entry) => entry.provider === 'codex');
  assert.ok(claudeEntry);
  assert.ok(codexEntry);
  assert.equal(claudeEntry.available, false);
  assert.ok(claudeEntry.unavailableReason);
  // Inactive profiles are excluded from the list entirely.
  assert.deepEqual(codexEntry.profiles, []);
  assert.equal(codexEntry.available, false);
});

test('catalog exposes an authenticated Claude CLI alongside optional profiles', async () => {
  const { service, authStates, profilesByProvider } = createHarness();
  profilesByProvider.claude = [];
  authStates.claude = { installed: true, authenticated: true };

  const catalog = await service.getPublicSelectionCatalog(1);
  const claudeEntry = catalog.providers.find((entry) => entry.provider === 'claude');
  assert.ok(claudeEntry);
  assert.equal(claudeEntry.available, true);
  assert.equal(claudeEntry.connectionAvailable, true);
  assert.deepEqual(claudeEntry.profiles, []);
});

test('catalog drops disconnected Cursor/OpenCode with a reason', async () => {
  const { service, authStates } = createHarness();
  authStates.cursor = { installed: true, authenticated: false, error: 'Not logged in' };

  const catalog = await service.getPublicSelectionCatalog(1);
  const cursorEntry = catalog.providers.find((entry) => entry.provider === 'cursor');
  assert.ok(cursorEntry);
  assert.equal(cursorEntry.available, false);
  assert.equal(cursorEntry.unavailableReason, 'Not logged in');
  assert.deepEqual(cursorEntry.profiles, []);
});

test('validateSelection accepts a valid Claude profile + catalog model', async () => {
  const { service } = createHarness();
  await service.validateSelection({
    userId: 1,
    provider: 'claude',
    providerProfileId: 1,
    model: 'claude-sonnet',
  });
});

test('text-completion selection validates effort and defaults to the lowest supported value', async () => {
  const { service } = createHarness();
  assert.deepEqual(await service.resolveDefaultTextCompletionSelection(1), {
    provider: 'claude',
    providerProfileId: 1,
    model: 'claude-sonnet',
    effort: 'low',
  });

  await service.validateSelection({
    userId: 1,
    provider: 'claude',
    providerProfileId: 1,
    model: 'claude-sonnet',
    effort: 'low',
  });
  await assert.rejects(
    service.validateSelection({
      userId: 1,
      provider: 'claude',
      providerProfileId: 1,
      model: 'claude-sonnet',
      effort: 'max',
    }),
    expectAppError('EFFORT_NOT_AVAILABLE'),
  );
  await assert.rejects(
    service.validateSelection({
      userId: 1,
      provider: 'claude',
      providerProfileId: 1,
      model: 'claude-opus',
      effort: 'low',
    }),
    expectAppError('EFFORT_UNSUPPORTED'),
  );
});

test('validateSelection accepts profile-less Claude/Codex only with a live CLI connection', async () => {
  const { service, authStates } = createHarness();
  await assert.rejects(
    service.validateSelection({ userId: 1, provider: 'claude', providerProfileId: null, model: 'claude-sonnet' }),
    expectAppError('PROVIDER_NOT_CONNECTED'),
  );
  authStates.claude = { installed: true, authenticated: true };
  authStates.codex = { installed: true, authenticated: true };
  await service.validateSelection({
    userId: 1,
    provider: 'claude',
    providerProfileId: null,
    model: 'claude-sonnet',
  });
  await service.validateSelection({
    userId: 1,
    provider: 'codex',
    providerProfileId: null,
    model: 'gpt-5',
  });
});

test('validateSelection rejects an inactive or missing profile', async () => {
  const { service, runtimeProfiles } = createHarness();
  runtimeProfiles.claude = runtimeProfiles.claude.filter((profile) => profile.id !== 1);

  await assert.rejects(
    service.validateSelection({ userId: 1, provider: 'claude', providerProfileId: 1, model: 'claude-sonnet' }),
    expectAppError('PROVIDER_PROFILE_NOT_FOUND'),
  );
});

test('validateSelection rejects Cursor with a profile id and when disconnected', async () => {
  const { service, authStates } = createHarness();

  await assert.rejects(
    service.validateSelection({ userId: 1, provider: 'cursor', providerProfileId: 5, model: 'cursor-fast' }),
    expectAppError('PROVIDER_PROFILE_UNSUPPORTED'),
  );

  authStates.cursor = { installed: true, authenticated: false, error: 'Not logged in' };
  await assert.rejects(
    service.validateSelection({ userId: 1, provider: 'cursor', providerProfileId: null, model: 'cursor-fast' }),
    expectAppError('PROVIDER_NOT_CONNECTED'),
  );
});

test('validateSelection accepts connected Cursor/OpenCode with a null profile', async () => {
  const { service } = createHarness();
  await service.validateSelection({
    userId: 1,
    provider: 'opencode',
    providerProfileId: null,
    model: 'opencode-default',
  });
});

test('validateSelection rejects a model outside the provider catalog and a missing model', async () => {
  const { service } = createHarness();
  await assert.rejects(
    service.validateSelection({ userId: 1, provider: 'claude', providerProfileId: 1, model: 'gpt-5' }),
    expectAppError('MODEL_NOT_AVAILABLE'),
  );
  await assert.rejects(
    service.validateSelection({ userId: 1, provider: 'claude', providerProfileId: 1, model: '  ' }),
    expectAppError('MODEL_REQUIRED'),
  );
});

test('validateSessionExecution gates a profile-less Claude session on live CLI auth', async () => {
  const { service, sessions, authStates, profilesByProvider, runtimeProfiles } = createHarness();
  profilesByProvider.claude = [];
  runtimeProfiles.claude = [];
  sessions.set('legacy', { provider: 'claude', provider_profile_id: null });

  await assert.rejects(
    service.validateSessionExecution({ userId: 1, sessionId: 'legacy' }),
    expectAppError('PROVIDER_NOT_CONNECTED'),
  );
  authStates.claude = { installed: true, authenticated: true };
  await service.validateSessionExecution({ userId: 1, sessionId: 'legacy' });
});

test('validateSessionExecution binds the same-provider default profile when an external session has no local CLI auth', async () => {
  const { service, sessions } = createHarness();
  sessions.set('external-codex', { provider: 'codex', provider_profile_id: null });

  const providerProfileId = await service.validateSessionExecution({
    userId: 1,
    sessionId: 'external-codex',
  });

  assert.equal(providerProfileId, 1);
  assert.equal(sessions.get('external-codex')?.provider_profile_id, 1);
});

test('validateSessionExecution blocks a session whose profile was deactivated and requires a user', async () => {
  const { service, sessions, runtimeProfiles } = createHarness();
  sessions.set('gone', { provider: 'claude', provider_profile_id: 2 });
  runtimeProfiles.claude = runtimeProfiles.claude.filter((profile) => profile.id !== 2);

  await assert.rejects(
    service.validateSessionExecution({ userId: 1, sessionId: 'gone' }),
    expectAppError('PROVIDER_PROFILE_NOT_FOUND'),
  );

  sessions.set('anon', { provider: 'claude', provider_profile_id: 1 });
  await assert.rejects(
    service.validateSessionExecution({ userId: null, sessionId: 'anon' }),
    expectAppError('PROVIDER_PROFILE_AUTH_REQUIRED'),
  );
});

test('validateSessionExecution blocks a disconnected Cursor session before the runtime', async () => {
  const { service, sessions, authStates } = createHarness();
  sessions.set('cursor-chat', { provider: 'cursor', provider_profile_id: null });
  authStates.cursor = { installed: true, authenticated: false, error: 'Not logged in' };

  await assert.rejects(
    service.validateSessionExecution({ userId: 1, sessionId: 'cursor-chat' }),
    expectAppError('PROVIDER_NOT_CONNECTED'),
  );
});

test('validateSessionExecution accepts a valid profile session and a connected Cursor session', async () => {
  const { service, sessions } = createHarness();
  sessions.set('ok-claude', { provider: 'claude', provider_profile_id: 1 });
  sessions.set('ok-cursor', { provider: 'cursor', provider_profile_id: null });

  await service.validateSessionExecution({ userId: 1, sessionId: 'ok-claude' });
  await service.validateSessionExecution({ userId: 1, sessionId: 'ok-cursor' });
});

test('validateSessionExecution rejects an unknown session', async () => {
  const { service } = createHarness();
  await assert.rejects(
    service.validateSessionExecution({ userId: 1, sessionId: 'missing' }),
    expectAppError('SESSION_NOT_FOUND'),
  );
});

test('getSessionSelection reads the stored provider/profile/model triple', () => {
  const { service, sessions } = createHarness();
  sessions.set('sel', { provider: 'claude', provider_profile_id: 2, model: 'claude-opus' });

  assert.deepEqual(service.getSessionSelection('sel'), {
    provider: 'claude',
    providerProfileId: 2,
    model: 'claude-opus',
  });
});
