import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProviderTextCompletionService,
  ProviderTextCompletionError,
} from '@/modules/providers/services/provider-text-completion.service.js';
import type {
  LLMProvider,
  ProviderProfileRuntime,
  ProviderRuntimeWriter,
  ProviderTextCompletionSelection,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const selections: Record<LLMProvider, ProviderTextCompletionSelection> = {
  claude: { provider: 'claude', providerProfileId: 11, model: 'claude-model', effort: 'low' },
  codex: { provider: 'codex', providerProfileId: 12, model: 'codex-model', effort: 'low' },
  cursor: { provider: 'cursor', providerProfileId: null, model: 'cursor-model', effort: 'low' },
  opencode: { provider: 'opencode', providerProfileId: null, model: 'opencode-model', effort: 'low' },
};

function profile(provider: 'claude' | 'codex', id: number): ProviderProfileRuntime {
  return {
    id,
    provider,
    title: `${provider} profile`,
    baseUrl: `https://${provider}.example/v1`,
    authType: 'api_key',
    isDefault: true,
    isActive: true,
    hasSecret: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    secretValue: `${provider}-secret`,
  };
}

function assertCompletionError(code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof ProviderTextCompletionError);
    assert.equal(error.code, code);
    return true;
  };
}

test('validates and forwards the exact four-provider selection into an isolated read-only run', async () => {
  const validations: ProviderTextCompletionSelection[] = [];
  const runs: Array<{
    provider: LLMProvider;
    prompt: string;
    options: Record<string, unknown>;
    writer: ProviderRuntimeWriter;
  }> = [];
  const profileLookups: Array<[number, string, number]> = [];
  const cleaned: string[] = [];
  const service = createProviderTextCompletionService({
    selection: {
      async validateSelection(value) {
        validations.push({
          provider: value.provider,
          providerProfileId: value.providerProfileId,
          model: value.model,
          effort: value.effort ?? null,
        });
      },
    },
    profiles: {
      getProviderProfileForRuntime(userId, provider, profileId) {
        profileLookups.push([userId, provider, profileId]);
        return profile(provider, profileId);
      },
    },
    runtime: {
      hasRuntime: () => true,
      async run(provider, prompt, options, writer) {
        runs.push({ provider, prompt, options, writer });
        writer.send({
          kind: 'text',
          role: 'assistant',
          content: `${provider} answer`,
          provider,
        });
        writer.send({ kind: 'complete', provider, exitCode: 0 });
      },
      async abort() {
        throw new Error('abort must not run for a successful completion');
      },
    },
    createRuntimeId: () => `runtime-${runs.length + 1}`,
    createTemporaryDirectory: async () => '/isolated/completion',
    removeTemporaryDirectory: async (directory) => { cleaned.push(directory); },
  });

  for (const provider of Object.keys(selections) as LLMProvider[]) {
    const result = await service.complete({
      userId: 7,
      selection: selections[provider],
      prompt: `private prompt for ${provider}`,
    });
    assert.deepEqual(result, {
      text: `${provider} answer`,
      selection: selections[provider],
    });
  }

  assert.deepEqual(validations, Object.values(selections));
  assert.deepEqual(profileLookups, [
    [7, 'claude', 11],
    [7, 'codex', 12],
  ]);
  assert.equal(runs.length, 4);
  for (const run of runs) {
    assert.equal(run.options.cwd, '/isolated/completion');
    assert.equal(run.options.projectPath, undefined);
    assert.equal(run.options.model, selections[run.provider].model);
    assert.equal(run.options.permissionMode, 'plan');
    assert.equal(run.options.taskMasterReadOnly, true);
    assert.equal(run.options.skipPermissions, false);
    assert.equal(run.writer.userId, null);
    assert.match(String(run.options.sessionId), /^runtime-/);
    assert.doesNotMatch(JSON.stringify(run.options), /bypassPermissions|danger-full-access|workspace-write|--auto/);
  }
  assert.deepEqual(
    (runs[0].options.toolsSettings as { allowedTools: string[] }).allowedTools,
    [],
  );
  assert.equal(
    (runs[0].options.toolsSettings as { disallowedTools: string[] }).disallowedTools.includes('Write'),
    true,
  );
  assert.equal((runs[0].options.claudeProviderProfile as ProviderProfileRuntime).id, 11);
  assert.equal((runs[1].options.codexProviderProfile as ProviderProfileRuntime).id, 12);
  assert.equal('claudeProviderProfile' in runs[2].options, false);
  assert.equal('codexProviderProfile' in runs[3].options, false);
  assert.deepEqual(cleaned, Array(4).fill('/isolated/completion'));
});

test('reuses one hidden native session per conversation selection with low effort', async () => {
  const runs: Array<Record<string, unknown>> = [];
  const restoredDirectories: string[] = [];
  let createdDirectories = 0;
  const dependencies = {
    selection: { validateSelection: async () => undefined },
    profiles: {
      getProviderProfileForRuntime: (
        _userId: number,
        provider: 'claude' | 'codex',
        id: number,
      ) => profile(provider, id),
    },
    runtime: {
      hasRuntime: () => true,
      async run(
        _provider: LLMProvider,
        _prompt: string,
        options: Record<string, unknown>,
        writer: ProviderRuntimeWriter,
      ) {
        runs.push(options);
        const providerSessionId = typeof options.providerSessionId === 'string'
          ? options.providerSessionId
          : `native-${runs.length}`;
        writer.setSessionId?.(providerSessionId);
        writer.send({ kind: 'text', role: 'assistant', content: 'fix: reuse generator session' });
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      abort: async () => true,
    },
    createRuntimeId: () => `runtime-${runs.length + 1}`,
    createTemporaryDirectory: async () => `/isolated/run-${++createdDirectories}`,
    ensureTemporaryDirectory: async (directoryPath: string) => {
      restoredDirectories.push(directoryPath);
    },
    removeTemporaryDirectory: async () => undefined,
  };
  const service = createProviderTextCompletionService(dependencies as Parameters<
    typeof createProviderTextCompletionService
  >[0] & { ensureTemporaryDirectory(directoryPath: string): Promise<void> });
  const complete = (
    conversationKey: string,
    nextSelection: ProviderTextCompletionSelection = selections.codex,
  ) => service.complete({
    userId: 7,
    selection: nextSelection,
    prompt: 'bounded prompt',
    conversationKey,
  } as Parameters<typeof service.complete>[0] & { conversationKey: string });

  await complete('project-1');
  await complete('project-1');
  await complete('project-1', { ...selections.codex, model: 'another-model' });
  await complete('project-2');

  assert.deepEqual(runs.map((options) => options.sessionId), [
    'runtime-1',
    'runtime-2',
    'runtime-3',
    'runtime-4',
  ]);
  assert.deepEqual(runs.map((options) => options.providerSessionId), [
    undefined,
    'native-1',
    undefined,
    undefined,
  ]);
  assert.deepEqual(runs.map((options) => options.cwd), [
    '/isolated/run-1',
    '/isolated/run-1',
    '/isolated/run-2',
    '/isolated/run-3',
  ]);
  assert.deepEqual(restoredDirectories, ['/isolated/run-1']);
  assert.equal(runs.every((options) => options.effort === 'low'), true);
});

test('normalizes legacy and normalized assistant output without accepting terminal-only runs', async () => {
  const events: unknown[][] = [
    [{ type: 'claude-response', data: { message: { content: [{ type: 'text', text: 'claude text' }] } } }],
    [{ kind: 'text', role: 'assistant', content: 'codex text' }],
    [{ type: 'assistant', message: { content: [{ type: 'text', text: 'cursor text' }] } }],
    [{ kind: 'stream_delta', content: 'open' }, { kind: 'stream_delta', content: 'code text' }],
  ];
  let runIndex = 0;
  const service = createProviderTextCompletionService({
    selection: { validateSelection: async () => undefined },
    profiles: { getProviderProfileForRuntime: (_userId, provider, id) => profile(provider, id) },
    runtime: {
      hasRuntime: () => true,
      async run(_provider, _prompt, _options, writer) {
        for (const event of events[runIndex++] ?? []) writer.send(event);
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      abort: async () => true,
    },
    createTemporaryDirectory: async () => '/isolated',
    removeTemporaryDirectory: async () => undefined,
  });

  const output: string[] = [];
  for (const provider of Object.keys(selections) as LLMProvider[]) {
    output.push((await service.complete({
      userId: 7,
      selection: selections[provider],
      prompt: 'prompt',
    })).text);
  }
  assert.deepEqual(output, ['claude text', 'codex text', 'cursor text', 'opencode text']);

  const empty = createProviderTextCompletionService({
    selection: { validateSelection: async () => undefined },
    runtime: {
      hasRuntime: () => true,
      async run(_provider, _prompt, _options, writer) {
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      abort: async () => true,
    },
    createTemporaryDirectory: async () => '/isolated',
    removeTemporaryDirectory: async () => undefined,
  });
  await assert.rejects(
    empty.complete({ userId: 7, selection: selections.cursor, prompt: 'prompt' }),
    assertCompletionError('GENERATION_FAILED'),
  );
});

test('caller cancellation and timeout abort the transient runtime exactly once and always clean up', async () => {
  const aborts: Array<[LLMProvider, string]> = [];
  const cleaned: string[] = [];
  const pendingRun = () => new Promise<never>(() => undefined);
  const createService = (timeoutMs: number) => createProviderTextCompletionService({
    selection: { validateSelection: async () => undefined },
    runtime: {
      hasRuntime: () => true,
      run: pendingRun,
      async abort(provider, runtimeId) {
        aborts.push([provider, runtimeId]);
        return true;
      },
    },
    timeoutMs,
    createRuntimeId: () => 'transient-runtime',
    createTemporaryDirectory: async () => '/isolated/cancelled',
    removeTemporaryDirectory: async (directory) => { cleaned.push(directory); },
  });

  const controller = new AbortController();
  const cancelled = createService(1_000).complete({
    userId: 7,
    selection: selections.cursor,
    prompt: 'prompt',
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(cancelled, assertCompletionError('GENERATION_CANCELLED'));

  await assert.rejects(
    createService(5).complete({ userId: 7, selection: selections.opencode, prompt: 'prompt' }),
    assertCompletionError('GENERATION_TIMEOUT'),
  );
  assert.deepEqual(aborts, [
    ['cursor', 'transient-runtime'],
    ['opencode', 'transient-runtime'],
  ]);
  assert.deepEqual(cleaned, ['/isolated/cancelled', '/isolated/cancelled']);
});

test('safe logs contain lifecycle metadata but never prompts, output, paths, or profile secrets', async () => {
  const logs: unknown[][] = [];
  const service = createProviderTextCompletionService({
    selection: { validateSelection: async () => undefined },
    profiles: { getProviderProfileForRuntime: (_userId, provider, id) => profile(provider, id) },
    runtime: {
      hasRuntime: () => true,
      async run(_provider, _prompt, _options, writer) {
        writer.send({ kind: 'text', role: 'assistant', content: 'private generated output' });
        writer.send({ kind: 'complete', exitCode: 0 });
      },
      abort: async () => true,
    },
    logger: { info: (...values) => logs.push(values), warn: (...values) => logs.push(values) },
    createTemporaryDirectory: async () => '/private/temporary/path',
    removeTemporaryDirectory: async () => undefined,
  });

  await service.complete({
    userId: 7,
    selection: selections.claude,
    prompt: 'private staged patch prompt',
  });
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, /private staged patch prompt|private generated output|private\/temporary|claude-secret/);
  assert.match(serialized, /claude/);
});

test('maps provider/profile/model validation and unsupported runtime failures to typed recovery codes', async () => {
  const cases = [
    [new AppError('missing profile', { code: 'PROVIDER_PROFILE_NOT_FOUND', statusCode: 404 }), 'PROVIDER_PROFILE_UNAVAILABLE'],
    [new AppError('missing model', { code: 'MODEL_NOT_AVAILABLE', statusCode: 400 }), 'MODEL_UNAVAILABLE'],
    [new AppError('not connected', { code: 'PROVIDER_NOT_CONNECTED', statusCode: 400 }), 'PROVIDER_UNAVAILABLE'],
  ] as const;
  for (const [failure, expectedCode] of cases) {
    const service = createProviderTextCompletionService({
      selection: { validateSelection: async () => { throw failure; } },
      runtime: { hasRuntime: () => true, run: async () => undefined, abort: async () => true },
    });
    await assert.rejects(
      service.complete({ userId: 7, selection: selections.cursor, prompt: 'prompt' }),
      assertCompletionError(expectedCode),
    );
  }

  const unsupported = createProviderTextCompletionService({
    selection: { validateSelection: async () => undefined },
    runtime: { hasRuntime: () => false, run: async () => undefined, abort: async () => true },
  });
  await assert.rejects(
    unsupported.complete({ userId: 7, selection: selections.cursor, prompt: 'prompt' }),
    assertCompletionError('PROVIDER_UNSUPPORTED_FOR_GENERATION'),
  );
});
