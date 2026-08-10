import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTranscriptionBody,
  fetchTextWithTimeout,
  isUnsupportedSttContextError,
  normalizeVoiceSttContext,
} from '../voice-proxy.js';

const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
});

test('normalizes client STT context and forwards OpenAI-compatible multipart fields', () => {
  const context = normalizeVoiceSttContext({
    sttPrompt: '  Persian engineering dictation  ',
    sttLanguages: '["FA","en","de"]',
    sttTerms: '[" useVoiceInput ","gpt-4o-mini","useVoiceInput","<unsafe>"]',
  });

  assert.deepEqual(context, {
    prompt: 'Persian engineering dictation',
    languages: ['fa', 'en'],
    terms: ['useVoiceInput', 'gpt-4o-mini'],
  });

  const body = buildTranscriptionBody(
    {
      buffer: Buffer.from('audio'),
      mimetype: 'audio/webm',
      originalname: 'recording.webm',
    },
    { sttModel: 'gpt-4o-mini-transcribe' },
    context,
    true,
  );
  assert.equal(body.get('prompt'), 'Persian engineering dictation');
  assert.deepEqual(body.getAll('languages[]'), ['fa', 'en']);
  assert.deepEqual(body.getAll('keywords[]'), ['useVoiceInput', 'gpt-4o-mini']);
});

test('context-free retry body removes all optional fields', () => {
  const body = buildTranscriptionBody(
    { buffer: Buffer.from('audio'), mimetype: 'audio/webm', originalname: 'recording.webm' },
    { sttModel: 'whisper-1' },
    { prompt: 'context', languages: ['fa'], terms: ['useVoiceInput'] },
    false,
  );

  assert.equal(body.get('model'), 'whisper-1');
  assert.equal(body.get('prompt'), null);
  assert.deepEqual(body.getAll('languages[]'), []);
  assert.deepEqual(body.getAll('keywords[]'), []);
});

test('server retry classifier rejects unrelated and non-compatibility errors', () => {
  assert.equal(isUnsupportedSttContextError(400, 'unexpected field languages[]'), true);
  assert.equal(isUnsupportedSttContextError(422, 'keywords are not supported'), true);
  assert.equal(isUnsupportedSttContextError(429, 'prompt is not supported'), false);
  assert.equal(isUnsupportedSttContextError(400, 'audio is corrupt'), false);
  assert.equal(
    isUnsupportedSttContextError(400, 'unsupported audio format; request prompt was: hello'),
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

test('text response timeout remains active while the upstream body stalls', async () => {
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => ({
    text: () => new Promise<string>((_resolve, reject) => {
      const abort = () => reject(new DOMException('aborted', 'AbortError'));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener('abort', abort, { once: true });
    }),
  })) as typeof fetch;

  await assert.rejects(
    fetchTextWithTimeout('https://voice.example/v1/chat/completions', {}, 5),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
});
