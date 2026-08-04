import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSonioxStartRequest } from './voice-stream-proxy.service.js';

test('maps normalized language hints and terms to the Soniox start frame', () => {
  const request = buildSonioxStartRequest('secret', {
    languageHints: [' FA ', 'en', 'de'],
    terms: [' useVoiceInput ', 'gpt-4o-mini', 'useVoiceInput'],
  });

  assert.deepEqual(request, {
    api_key: 'secret',
    model: process.env.SONIOX_STT_RT_MODEL || 'stt-rt-v5',
    audio_format: 'auto',
    enable_language_identification: true,
    language_hints: ['fa', 'en'],
    context: { terms: ['useVoiceInput', 'gpt-4o-mini'] },
  });
});

test('drops malformed optional context rather than forwarding it upstream', () => {
  const request = buildSonioxStartRequest('secret', {
    languageHints: ['not_a_code', '<fa>'],
    terms: ['<script>', 'line\nbreak'],
  });

  assert.equal('language_hints' in request, false);
  assert.equal('context' in request, false);
});
