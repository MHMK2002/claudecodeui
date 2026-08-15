import assert from 'node:assert/strict';
import test from 'node:test';

import type { VoiceConfig } from '../hooks/useVoiceConfig';

import {
  buildDirectTranscriptionBody,
  buildProxyTranscriptionBody,
  enhanceText,
  isUnsupportedSttContextError,
  transcribeVoice,
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
    cleanupProviderProfileId: null,
    cleanupModel: 'gpt-5.6-luna',
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

test('enhance sends raw text to the server proxy and returns the edited candidate', async () => {
  installConfig(config({
    baseUrl: 'https://voice.example/v1',
    cleanupEnabled: true,
    cleanupProviderProfileId: 17,
  }));
  let requestUrl = '';
  let requestBody: Record<string, unknown> | undefined;
  mockFetch(async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    const raw = String(requestBody?.text);
    assert.equal(raw.includes('useVoiceInput'), true);
    const edited = raw.replace('um ', '').replace('works', 'works.');
    return Response.json(
      { action: 'edit', text: edited },
      { headers: { 'X-Voice-Cleanup-Outcome': 'model_decision' } },
    );
  });

  const result = await enhanceText('  um useVoiceInput works  \n');

  assert.equal(result.status, 'edited');
  if (result.status === 'edited') {
    assert.equal(result.text, '  useVoiceInput works.  \n');
  }
  assert.equal(requestUrl, '/api/voice/cleanup');
  assert.equal(requestBody?.providerProfileId, 17);
  assert.equal(requestBody?.model, 'gpt-5.6-luna');
});

test('enhance is a no-request error while disabled', async () => {
  installConfig(config({ cleanupEnabled: false }));
  mockFetch(async () => {
    throw new Error('fetch must not be called');
  });

  const result = await enhanceText('  untouched raw transcript\n');
  assert.equal(result.status, 'error');
});

test('enhance never falls back to Local CLI when no Settings profile is selected', async () => {
  installConfig(config({ cleanupEnabled: true, cleanupProviderProfileId: null }));
  mockFetch(async () => {
    throw new Error('fetch must not be called');
  });

  const result = await enhanceText('  untouched raw transcript\n');
  assert.equal(result.status, 'error');
  if (result.status === 'error') {
    assert.match(result.message, /Settings/);
  }
});

test('enhance returns an error for an invalid schema response', async () => {
  installConfig(config({
    baseUrl: 'https://voice.example/v1',
    cleanupEnabled: true,
    cleanupProviderProfileId: 17,
  }));
  mockFetch(async () => Response.json('not-json'));

  const result = await enhanceText('  do not rename useVoiceInput\n');
  assert.equal(result.status, 'error');
});

test('enhance accepts an aggressive edit without validation (user reviews)', async () => {
  installConfig(config({
    baseUrl: 'https://voice.example/v1',
    cleanupEnabled: true,
    cleanupProviderProfileId: 17,
  }));
  mockFetch(async () => Response.json({ action: 'edit', text: 'totally rewritten text' }));

  const result = await enhanceText('  do not rename useVoiceInput\n');
  assert.equal(result.status, 'edited');
  if (result.status === 'edited') {
    assert.equal(result.text, 'totally rewritten text');
  }
});

test('enhance honors a keep decision', async () => {
  installConfig(config({ cleanupEnabled: true, cleanupProviderProfileId: 17 }));
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

  const result = await enhanceText('Keep useVoiceInput exactly.\n');
  assert.equal(result.status, 'kept');
  assert.equal(capturedUrl, '/api/voice/cleanup');
  assert.equal(capturedBody?.mode, 'clean_transcript');
  assert.equal(String(capturedBody?.text).includes('useVoiceInput'), true);
  assert.equal(capturedBody?.providerProfileId, 17);
  assert.equal(capturedBody?.model, 'gpt-5.6-luna');
});

test('enhance timeout and caller cancellation both surface as errors', async () => {
  installConfig(config({
    baseUrl: 'https://voice.example/v1',
    cleanupEnabled: true,
    cleanupProviderProfileId: 17,
  }));
  mockFetch((_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const abort = () => reject(new DOMException('aborted', 'AbortError'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  }));

  const timeoutResult = await enhanceText('  keep this raw\n', { timeoutMs: 5 });
  assert.equal(timeoutResult.status, 'error');

  const controller = new AbortController();
  const pending = enhanceText('  keep this raw\n', { signal: controller.signal });
  controller.abort();
  const cancelledResult = await pending;
  assert.equal(cancelledResult.status, 'error');
});
