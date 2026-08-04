import assert from 'node:assert/strict';
import test from 'node:test';

import type { VoiceConfig } from '../hooks/useVoiceConfig';

import {
  buildDirectTranscriptionBody,
  buildProxyTranscriptionBody,
  cleanupVoiceTranscript,
  isUnsupportedSttContextError,
  transcribeVoice,
  type VoiceCleanupOutcome,
} from './voiceApi';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const originalFetch = globalThis.fetch;

function config(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    baseUrl: '',
    apiKey: '',
    sttProvider: 'openai',
    sttModel: 'gpt-4o-mini-transcribe',
    sttPrompt: '',
    sttLanguages: [],
    sttTerms: [],
    ttsModel: '',
    ttsVoice: '',
    ttsFormat: '',
    sonioxApiKey: '',
    cleanupEnabled: false,
    cleanupModel: 'gpt-4o-mini',
    cleanupPrompt: 'Only conservative edits.',
    micDeviceId: '',
    ...overrides,
  };
}

function installConfig(value: VoiceConfig): void {
  const storage = new MemoryStorage();
  storage.setItem('voiceConfig', JSON.stringify(value));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

function mockFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  globalThis.fetch = implementation as typeof fetch;
}

test.after(() => {
  globalThis.fetch = originalFetch;
});

test('serializes OpenAI-compatible and proxy STT context with their distinct field names', () => {
  const voiceConfig = config({
    sttPrompt: 'Persian engineering dictation',
    sttLanguages: ['fa', 'en'],
    sttTerms: ['useVoiceInput', 'gpt-4o-mini'],
  });
  const audio = new Blob(['audio'], { type: 'audio/webm' });

  const direct = buildDirectTranscriptionBody(audio, 'recording.webm', voiceConfig, true);
  assert.equal(direct.get('prompt'), 'Persian engineering dictation');
  assert.deepEqual(direct.getAll('languages[]'), ['fa', 'en']);
  assert.deepEqual(direct.getAll('keywords[]'), ['useVoiceInput', 'gpt-4o-mini']);
  assert.equal(direct.get('sttPrompt'), null);

  const proxy = buildProxyTranscriptionBody(audio, 'recording.webm', voiceConfig);
  assert.equal(proxy.get('sttPrompt'), 'Persian engineering dictation');
  assert.equal(proxy.get('sttLanguages'), '["fa","en"]');
  assert.equal(proxy.get('sttTerms'), '["useVoiceInput","gpt-4o-mini"]');
  assert.equal(proxy.get('prompt'), null);
});

test('retries direct STT once without context only for an explicit unsupported-field response', async () => {
  installConfig(config({ baseUrl: 'https://voice.example/v1', sttPrompt: 'context' }));
  const bodies: FormData[] = [];
  mockFetch(async (_input, init) => {
    bodies.push(init?.body as FormData);
    return bodies.length === 1
      ? new Response('unknown field prompt', { status: 422 })
      : Response.json({ text: 'done' });
  });

  const response = await transcribeVoice(new Blob(['audio']), 'recording.webm');
  assert.equal(response.ok, true);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].get('prompt'), 'context');
  assert.equal(bodies[1].get('prompt'), null);
});

test('classifies only explicit 400/422 optional-context compatibility failures', () => {
  assert.equal(isUnsupportedSttContextError(400, 'unknown field keywords[]'), true);
  assert.equal(isUnsupportedSttContextError(422, 'prompt is not supported'), true);
  assert.equal(isUnsupportedSttContextError(401, 'prompt is not supported'), false);
  assert.equal(isUnsupportedSttContextError(400, 'invalid audio file'), false);
  assert.equal(
    isUnsupportedSttContextError(400, 'unsupported audio format; request prompt was: hello'),
    false,
  );
  assert.equal(
    isUnsupportedSttContextError(422, 'audio codec unsupported; accepted languages: fa,en'),
    false,
  );
  assert.equal(
    isUnsupportedSttContextError(400, 'unexpected end of audio; prompt length: 10'),
    false,
  );
  assert.equal(
    isUnsupportedSttContextError(400, 'Unrecognized request argument supplied: prompt'),
    true,
  );
  assert.equal(isUnsupportedSttContextError(422, 'languages[] is an extra field'), true);
  assert.equal(
    isUnsupportedSttContextError(
      422,
      JSON.stringify({
        detail: [{
          type: 'extra_forbidden',
          loc: ['body', 'prompt'],
          msg: 'Extra inputs are not permitted',
        }],
      }),
    ),
    true,
  );
});

test('direct cleanup masks protected spans, accepts a safe edit, and preserves outer whitespace', async () => {
  installConfig(config({ baseUrl: 'https://voice.example/v1', cleanupEnabled: true }));
  let requestBody: Record<string, unknown> | undefined;
  mockFetch(async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    const messages = requestBody?.messages as Array<{ content: string }>;
    const userData = JSON.parse(messages[1].content) as { transcript: string };
    assert.equal(userData.transcript.includes('useVoiceInput'), false);
    const edited = userData.transcript.replace('um ', '').replace('works', 'works.');
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ action: 'edit', text: edited }) } }],
    });
  });
  const outcomes: VoiceCleanupOutcome[] = [];

  const cleaned = await cleanupVoiceTranscript('  um useVoiceInput works  \n', {
    onOutcome: (outcome) => outcomes.push(outcome),
  });

  assert.equal(cleaned, '  useVoiceInput works.  \n');
  assert.deepEqual(outcomes, ['edited']);
  assert.equal(requestBody?.model, 'gpt-4o-mini');
});

test('cleanup is a no-request exact no-op while disabled', async () => {
  const raw = '  untouched raw transcript\n';
  installConfig(config({ cleanupEnabled: false }));
  mockFetch(async () => {
    throw new Error('fetch must not be called');
  });
  const outcomes: VoiceCleanupOutcome[] = [];

  assert.equal(
    await cleanupVoiceTranscript(raw, {
      onOutcome: (outcome) => outcomes.push(outcome),
    }),
    raw,
  );
  assert.deepEqual(outcomes, ['disabled']);
});

test('cleanup skips a transcript whose protected placeholders exceed the request limit', async () => {
  const raw = Array.from({ length: 1000 }, () => 'useVoiceInput').join(' ');
  installConfig(config({ baseUrl: 'https://voice.example/v1', cleanupEnabled: true }));
  mockFetch(async () => {
    throw new Error('fetch must not be called');
  });
  const outcomes: VoiceCleanupOutcome[] = [];

  assert.equal(
    await cleanupVoiceTranscript(raw, {
      onOutcome: (outcome) => outcomes.push(outcome),
    }),
    raw,
  );
  assert.deepEqual(outcomes, ['ineligible']);
});

test('invalid schema and unsafe edits return the exact untrimmed raw transcript', async () => {
  const raw = '  do not rename useVoiceInput\n';
  installConfig(config({ baseUrl: 'https://voice.example/v1', cleanupEnabled: true }));
  let responseContent = 'not-json';
  mockFetch(async () => Response.json({ choices: [{ message: { content: responseContent } }] }));

  const invalidOutcomes: VoiceCleanupOutcome[] = [];
  assert.equal(
    await cleanupVoiceTranscript(raw, {
      onOutcome: (outcome) => invalidOutcomes.push(outcome),
    }),
    raw,
  );
  assert.deepEqual(invalidOutcomes, ['invalid_schema']);

  responseContent = JSON.stringify({ action: 'edit', text: 'rename it' });
  const unsafeOutcomes: VoiceCleanupOutcome[] = [];
  assert.equal(
    await cleanupVoiceTranscript(raw, {
      onOutcome: (outcome) => unsafeOutcomes.push(outcome),
    }),
    raw,
  );
  assert.deepEqual(unsafeOutcomes, ['unsafe_edit']);
});

test('proxy cleanup sends the same masked contract and honors keep', async () => {
  const raw = 'Keep useVoiceInput exactly.\n';
  installConfig(config({ cleanupEnabled: true }));
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> | undefined;
  mockFetch(async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body));
    return Response.json(
      { action: 'keep' },
      { headers: { 'X-Voice-Cleanup-Outcome': 'model_decision' } },
    );
  });

  assert.equal(await cleanupVoiceTranscript(raw), raw);
  assert.equal(capturedUrl, '/api/voice/cleanup');
  assert.equal(capturedBody?.mode, 'clean_transcript');
  assert.equal(String(capturedBody?.text).includes('useVoiceInput'), false);
});

test('cleanup timeout and caller cancellation both fail soft to the exact raw transcript', async () => {
  const raw = '  keep this raw\n';
  installConfig(config({ baseUrl: 'https://voice.example/v1', cleanupEnabled: true }));
  mockFetch((_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const abort = () => reject(new DOMException('aborted', 'AbortError'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  }));

  const timeoutOutcomes: VoiceCleanupOutcome[] = [];
  assert.equal(
    await cleanupVoiceTranscript(raw, {
      timeoutMs: 5,
      onOutcome: (outcome) => timeoutOutcomes.push(outcome),
    }),
    raw,
  );
  assert.deepEqual(timeoutOutcomes, ['timeout']);

  const controller = new AbortController();
  const cancelledOutcomes: VoiceCleanupOutcome[] = [];
  const pending = cleanupVoiceTranscript(raw, {
    signal: controller.signal,
    onOutcome: (outcome) => cancelledOutcomes.push(outcome),
  });
  controller.abort();
  assert.equal(await pending, raw);
  assert.deepEqual(cancelledOutcomes, ['cancelled']);
});
