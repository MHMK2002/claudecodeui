import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CLEANUP_PROMPT,
  normalizeSttLanguages,
  normalizeSttPrompt,
  normalizeSttTerms,
  readVoiceConfig,
} from './useVoiceConfig';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function installStorage(value?: unknown): void {
  const storage = new MemoryStorage();
  if (value !== undefined) storage.setItem('voiceConfig', JSON.stringify(value));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

test('normalizes STT prompt, languages, and terms at their public limits', () => {
  assert.equal(normalizeSttPrompt(`  ${'a'.repeat(5000)}  `).length, 4000);
  assert.deepEqual(normalizeSttLanguages('FA, en fa invalid_code de'), ['fa', 'en']);
  assert.deepEqual(
    normalizeSttTerms([' useVoiceInput ', 'useVoiceInput', '<unsafe>', 'gpt-4o-mini']),
    ['useVoiceInput', 'gpt-4o-mini'],
  );
});

test('migrates legacy stored voice config with safe defaults for new fields', () => {
  installStorage({
    baseUrl: 'https://voice.example/v1',
    cleanupEnabled: true,
    cleanupPrompt: 42,
    sttLanguages: 'FA, en',
    sttTerms: 'useVoiceInput\n--force',
  });

  const config = readVoiceConfig();
  assert.equal(config.baseUrl, 'https://voice.example/v1');
  assert.equal(config.cleanupEnabled, true);
  assert.equal(config.cleanupPrompt, DEFAULT_CLEANUP_PROMPT);
  assert.deepEqual(config.sttLanguages, ['fa', 'en']);
  assert.deepEqual(config.sttTerms, ['useVoiceInput', '--force']);
  assert.equal(config.sttPrompt, '');
});

test('falls back to defaults for malformed storage', () => {
  installStorage(['not', 'a', 'config']);
  const config = readVoiceConfig();

  assert.equal(config.cleanupEnabled, false);
  assert.deepEqual(config.sttLanguages, []);
  assert.deepEqual(config.sttTerms, []);
});
