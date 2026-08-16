import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import JSZip from 'jszip';

import { createSessionExportService } from '@/modules/providers/services/session-export.service.js';
import type { FetchHistoryResult, LLMProvider, NormalizedMessage } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { serializeTranscriptCanonicalV1 } from '../../../../shared/session-export-contract.js';

type Dependencies = Parameters<typeof createSessionExportService>[0];
type SessionRecord = NonNullable<ReturnType<Dependencies['getSessionById']>>;

const providers: LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];

function createSession(provider: string): SessionRecord {
  return {
    session_id: `${provider}-session`,
    provider,
    provider_session_id: `${provider}-native`,
    project_path: '/workspace/project',
    custom_name: `${provider} export`,
    created_at: '2026-08-16T00:00:00.000Z',
    updated_at: '2026-08-16T00:01:00.000Z',
    parent_session_id: null,
  };
}

function createMessage(provider: LLMProvider): NormalizedMessage {
  return {
    id: `${provider}-message`,
    sessionId: `${provider}-session`,
    timestamp: '2026-08-16T00:00:00.000Z',
    provider,
    kind: 'text',
    role: 'user',
    content: `Hello from ${provider}`,
  };
}

function createHistory(
  messages: NormalizedMessage[],
  overrides: Partial<FetchHistoryResult> = {},
): FetchHistoryResult {
  return {
    messages,
    total: messages.length,
    hasMore: false,
    offset: 0,
    limit: null,
    ...overrides,
  };
}

function transcriptDigest(messages: NormalizedMessage[]): string {
  return createHash('sha256')
    .update(serializeTranscriptCanonicalV1(messages))
    .digest('hex');
}

async function expectExportError(
  history: unknown,
  code: string,
): Promise<void> {
  const service = createSessionExportService({
    getSessionById: () => createSession('codex'),
    fetchHistory: async () => history as FetchHistoryResult,
  });
  await assert.rejects(
    service.exportSession('codex-session', 'zip', transcriptDigest([])),
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

test('ZIP construction fetches complete history and emits chat files for all four providers', async () => {
  const sessions = new Map(providers.map((provider) => [
    `${provider}-session`,
    createSession(provider),
  ]));
  const historyCalls: Array<{ sessionId: string; limit: null; offset: number }> = [];
  const service = createSessionExportService({
    getSessionById: (sessionId) => sessions.get(sessionId) ?? null,
    fetchHistory: async (sessionId, options) => {
      historyCalls.push({ sessionId, ...options });
      const provider = sessionId.replace(/-session$/, '') as LLMProvider;
      return createHistory([createMessage(provider)]);
    },
  });

  for (const provider of providers) {
      const messages = [createMessage(provider)];
      const result = await service.exportSession(
        `${provider}-session`,
        'zip',
        transcriptDigest(messages),
      );
    assert.equal(result.contentType, 'application/zip');
    assert.ok(result.buffer.length > 0);

    const archive = await JSZip.loadAsync(result.buffer);
    const markdown = await archive.file('chat.md')?.async('string');
    const json = await archive.file('chat.json')?.async('string');
    const manifest = await archive.file('manifest.json')?.async('string');
    assert.match(markdown ?? '', new RegExp(`Hello from ${provider}`));
    assert.ok(json);
    assert.ok(manifest);
    const payload = JSON.parse(json) as { metadata: { provider: string }; messageCount: number };
    assert.equal(payload.metadata.provider, provider);
    assert.equal(payload.messageCount, 1);
    const parsedManifest = JSON.parse(manifest) as { files: Array<{ path: string }> };
    assert.deepEqual(parsedManifest.files.map((file) => file.path), ['chat.json', 'chat.md']);
  }

  assert.deepEqual(historyCalls, providers.map((provider) => ({
    sessionId: `${provider}-session`,
    limit: null,
    offset: 0,
  })));
});

test('ZIP export rejects unknown legacy provider values', async () => {
  const service = createSessionExportService({
    getSessionById: () => createSession('unknown'),
    fetchHistory: async () => createHistory([]),
  });
  await assert.rejects(
    service.exportSession('unknown-session', 'zip', transcriptDigest([])),
    (error: unknown) => error instanceof AppError && error.code === 'EXPORT_PROVIDER_UNSUPPORTED',
  );
});

test('ZIP export rejects malformed provider history instead of coercing it to empty', async (t) => {
  const message = createMessage('codex');
  const malformedCases: Array<{ name: string; value: unknown }> = [
    { name: 'missing result', value: undefined },
    { name: 'missing messages', value: { total: 0, hasMore: false, offset: 0, limit: null } },
    { name: 'messages is not an array', value: { messages: {}, total: 0, hasMore: false, offset: 0, limit: null } },
    { name: 'missing total', value: { messages: [message], hasMore: false, offset: 0, limit: null } },
    { name: 'missing hasMore', value: { messages: [message], total: 1, offset: 0, limit: null } },
    { name: 'missing offset', value: { messages: [message], total: 1, hasMore: false, limit: null } },
    { name: 'missing limit', value: { messages: [message], total: 1, hasMore: false, offset: 0 } },
    {
      name: 'malformed message',
      value: createHistory([{ ...message, id: '' }]),
    },
    {
      name: 'message belongs to another session',
      value: createHistory([{ ...message, sessionId: 'other-session' }]),
    },
  ];

  for (const malformed of malformedCases) {
    await t.test(malformed.name, async () => {
      await expectExportError(malformed.value, 'EXPORT_HISTORY_INVALID');
    });
  }
});

test('ZIP export rejects partial or inconsistent full-history responses', async (t) => {
  const message = createMessage('codex');
  const incompleteCases: Array<{ name: string; value: FetchHistoryResult }> = [
    {
      name: 'hasMore remains true',
      value: createHistory([message], { total: 2, hasMore: true }),
    },
    {
      name: 'declared total differs from row count',
      value: createHistory([message], { total: 2 }),
    },
    {
      name: 'full history starts at a non-zero offset',
      value: createHistory([message], { offset: 1 }),
    },
    {
      name: 'provider applies an unexpected page limit',
      value: createHistory([message], { limit: 1 }),
    },
  ];

  for (const incomplete of incompleteCases) {
    await t.test(incomplete.name, async () => {
      await expectExportError(incomplete.value, 'EXPORT_HISTORY_INCOMPLETE');
    });
  }
});

test('ZIP export translates provider history failures to a typed export error', async () => {
  const service = createSessionExportService({
    getSessionById: () => createSession('codex'),
    fetchHistory: async () => {
      throw new Error('provider transcript read failed');
    },
  });

  await assert.rejects(
    service.exportSession('codex-session', 'zip', transcriptDigest([])),
    (error: unknown) => error instanceof AppError
      && error.code === 'EXPORT_HISTORY_UNAVAILABLE'
      && error.statusCode === 502,
  );
});

test('ZIP export rejects a request-specific digest mismatch with a typed conflict', async () => {
  const message = createMessage('codex');
  const service = createSessionExportService({
    getSessionById: () => createSession('codex'),
    fetchHistory: async () => createHistory([message]),
  });

  await assert.rejects(
    service.exportSession('codex-session', 'zip', '0'.repeat(64)),
    (error: unknown) => error instanceof AppError
      && error.code === 'EXPORT_HISTORY_INCOMPLETE'
      && error.statusCode === 409,
  );
});
