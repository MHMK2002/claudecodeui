import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CodexProviderProfileRuntime,
  ProviderModelsDefinition,
} from '@/shared/types.js';

import { buildCleanupInput } from '../../../../../shared/voice-cleanup-contract.js';

import {
  CodexVoiceCleanupError,
  createCodexVoiceCleanupService,
  extractResponsesOutputText,
  selectLowestReasoningEffort,
} from './codex-voice-cleanup.service.js';

const models: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      effort: {
        default: 'medium',
        values: [{ value: 'high' }, { value: 'low' }, { value: 'minimal' }],
      },
    },
  ],
  DEFAULT: 'gpt-5.6-luna',
};

const cleanupInput = {
  userId: 7,
  providerProfileId: 12,
  model: 'gpt-5.6-luna',
  transcript: 'raw text',
  instructions: 'Fix punctuation only.',
};

function customProfile(overrides: Partial<CodexProviderProfileRuntime> = {}): CodexProviderProfileRuntime {
  return {
    id: 12,
    provider: 'codex',
    title: 'Gateway',
    baseUrl: 'https://gateway.example/v1',
    authType: 'api_key',
    isDefault: false,
    isActive: true,
    hasSecret: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    secretValue: 'custom-secret',
    ...overrides,
  };
}

function assertCleanupError(code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof CodexVoiceCleanupError);
    assert.equal(error.code, code);
    return true;
  };
}

test('Settings-backed Codex cleanup sends one compact raw Responses request', async () => {
  let capturedUrl = '';
  let capturedHeaders: RequestInit['headers'];
  let capturedBody: Record<string, unknown> | null = null;
  const service = createCodexVoiceCleanupService({
    getModels: async () => models,
    getProfile: () => customProfile({ baseUrl: 'https://codex.example/v1', secretValue: 'server-secret' }),
    fetchFn: (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ output_text: 'clean text', usage: { input_tokens: 357 } });
    }) as typeof fetch,
  });

  const result = await service.cleanup(cleanupInput);

  assert.equal(capturedUrl, 'https://codex.example/v1/responses');
  assert.deepEqual(capturedHeaders, {
    Authorization: 'Bearer server-secret',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(capturedBody, {
    model: 'gpt-5.6-luna',
    input: buildCleanupInput(cleanupInput.transcript, cleanupInput.instructions),
    reasoning: { effort: 'minimal' },
    text: { verbosity: 'low' },
    tools: [],
    store: false,
    max_output_tokens: 256,
  });
  assert.equal('system' in (capturedBody as Record<string, unknown>), false);
  assert.equal('developer' in (capturedBody as Record<string, unknown>), false);
  assert.equal('instructions' in (capturedBody as Record<string, unknown>), false);
  assert.deepEqual(result, {
    decision: { action: 'edit', text: 'clean text' },
    model: 'gpt-5.6-luna',
    inputTokens: 357,
  });
});

test('custom cleanup resolves only the selected user profile and parses nested output', async () => {
  const lookups: Array<[number, number]> = [];
  let capturedUrl = '';
  const service = createCodexVoiceCleanupService({
    getModels: async () => models,
    getProfile: (userId, profileId) => {
      lookups.push([userId, profileId]);
      return customProfile();
    },
    fetchFn: (async (input) => {
      capturedUrl = String(input);
      return Response.json({
        output: [{ content: [{ type: 'output_text', text: 'raw ' }, { type: 'output_text', text: 'text' }] }],
      });
    }) as typeof fetch,
  });

  const result = await service.cleanup({ ...cleanupInput, providerProfileId: 12 });

  assert.deepEqual(lookups, [[7, 12]]);
  assert.equal(capturedUrl, 'https://gateway.example/v1/responses');
  assert.deepEqual(result.decision, { action: 'keep' });
});

test('rejects an unowned, missing, or inactive custom profile before fetching', async () => {
  let fetchCalls = 0;
  const createService = (profile: CodexProviderProfileRuntime | null) => createCodexVoiceCleanupService({
    getModels: async () => models,
    getProfile: (userId, profileId) => {
      assert.equal(userId, 7);
      assert.equal(profileId, 12);
      return profile;
    },
    fetchFn: (async () => {
      fetchCalls += 1;
      return Response.json({ output_text: 'unexpected' });
    }) as typeof fetch,
  });

  await assert.rejects(
    createService(null).cleanup({ ...cleanupInput, providerProfileId: 12 }),
    assertCleanupError('PROFILE_NOT_FOUND'),
  );
  await assert.rejects(
    createService(customProfile({ isActive: false })).cleanup({ ...cleanupInput, providerProfileId: 12 }),
    assertCleanupError('PROFILE_NOT_FOUND'),
  );
  assert.equal(fetchCalls, 0);
});

test('rejects models outside the server Codex catalog', async () => {
  const service = createCodexVoiceCleanupService({
    getModels: async () => models,
    getProfile: () => customProfile(),
  });

  await assert.rejects(
    service.cleanup({ ...cleanupInput, model: 'made-up-model' }),
    assertCleanupError('MODEL_UNSUPPORTED'),
  );
});

test('rejects Local CLI cleanup before catalog or network access', async () => {
  let modelCalls = 0;
  let fetchCalls = 0;
  const service = createCodexVoiceCleanupService({
    getModels: async () => {
      modelCalls += 1;
      return models;
    },
    fetchFn: (async () => {
      fetchCalls += 1;
      return Response.json({ output_text: 'unexpected' });
    }) as typeof fetch,
  });

  await assert.rejects(
    service.cleanup({ ...cleanupInput, providerProfileId: null as unknown as number }),
    assertCleanupError('PROFILE_REQUIRED'),
  );
  assert.equal(modelCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('selects the lightest supported reasoning effort and extracts Responses text defensively', () => {
  assert.equal(selectLowestReasoningEffort(models.OPTIONS[0]), 'minimal');
  assert.equal(selectLowestReasoningEffort({ value: 'plain', label: 'Plain' }), null);
  assert.equal(extractResponsesOutputText({ output_text: 'direct' }), 'direct');
  assert.equal(extractResponsesOutputText({
    output: [{ content: [{ type: 'refusal', text: 'no' }, { type: 'output_text', text: 'yes' }] }],
  }), 'yes');
  assert.equal(extractResponsesOutputText({ output: [] }), null);
  assert.equal(extractResponsesOutputText('malformed'), null);
});

test('maps empty output, upstream rejection, and secret-bearing fetch failures to redacted errors', async () => {
  const createService = (fetchFn: typeof fetch) => createCodexVoiceCleanupService({
    getModels: async () => models,
    getProfile: () => customProfile({ secretValue: 'server-secret' }),
    fetchFn,
  });

  await assert.rejects(
    createService((async () => Response.json({ output: [] })) as typeof fetch).cleanup(cleanupInput),
    assertCleanupError('INVALID_RESPONSE'),
  );
  await assert.rejects(
    createService((async () => new Response('secret upstream detail', { status: 401 })) as typeof fetch)
      .cleanup(cleanupInput),
    assertCleanupError('UPSTREAM_REJECTED'),
  );
  await assert.rejects(
    createService((async () => {
      throw new Error('network failed with server-secret');
    }) as typeof fetch).cleanup(cleanupInput),
    (error: unknown) => {
      assertCleanupError('UPSTREAM_UNAVAILABLE')(error);
      assert.equal(String(error).includes('server-secret'), false);
      return true;
    },
  );
});

test('distinguishes timeout from caller cancellation', async () => {
  const fetchUntilAborted = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => (
    new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException('aborted', 'AbortError'));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener('abort', abort, { once: true });
    })
  )) as typeof fetch;
  const service = createCodexVoiceCleanupService({
    getModels: async () => models,
    getProfile: () => customProfile({ secretValue: 'server-secret' }),
    fetchFn: fetchUntilAborted,
    timeoutMs: 5,
  });

  await assert.rejects(service.cleanup(cleanupInput), assertCleanupError('TIMEOUT'));

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    service.cleanup({ ...cleanupInput, signal: controller.signal }),
    assertCleanupError('CANCELLED'),
  );
});
