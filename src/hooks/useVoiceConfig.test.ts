import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CODEX_CLEANUP_MODEL,
  DEFAULT_CLEANUP_PROMPT,
  initializeVoiceSecrets,
  normalizeSttLanguages,
  normalizeSttPrompt,
  normalizeSttTerms,
  readVoiceConfig,
  resetVoiceSecretStateForTests,
} from './useVoiceConfig';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
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
  assert.equal(config.cleanupProviderProfileId, null);
  assert.equal(config.cleanupModel, DEFAULT_CODEX_CLEANUP_MODEL);
  assert.equal(config.cleanupPrompt, DEFAULT_CLEANUP_PROMPT);
  assert.deepEqual(config.sttLanguages, ['fa', 'en']);
  assert.deepEqual(config.sttTerms, ['useVoiceInput', '--force']);
  assert.equal(config.sttPrompt, '');
});

test('normalizes the selected Codex profile and migrates the legacy cleanup model', () => {
  installStorage({
    cleanupProviderProfileId: '23',
    cleanupModel: 'gpt-4o-mini',
  });

  const config = readVoiceConfig();
  assert.equal(config.cleanupProviderProfileId, 23);
  assert.equal(config.cleanupModel, DEFAULT_CODEX_CLEANUP_MODEL);

  installStorage({ cleanupProviderProfileId: '-1', cleanupModel: 'gpt-5.6' });
  const invalidProfile = readVoiceConfig();
  assert.equal(invalidProfile.cleanupProviderProfileId, null);
  assert.equal(invalidProfile.cleanupModel, 'gpt-5.6');
});

test('falls back to defaults for malformed storage', () => {
  installStorage(['not', 'a', 'config']);
  const config = readVoiceConfig();

  assert.equal(config.cleanupEnabled, false);
  assert.deepEqual(config.sttLanguages, []);
  assert.deepEqual(config.sttTerms, []);
});

test('migrates legacy secrets only after secure write and read-back', async () => {
  resetVoiceSecretStateForTests();
  installStorage({
    baseUrl: 'https://voice.example/v1',
    apiKey: 'legacy-openai-secret',
    sonioxApiKey: 'legacy-soniox-secret',
  });
  let secure = { apiKey: '', sonioxApiKey: '' };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      cloudcliDesktopVoiceSecrets: {
        get: async () => ({ ...secure }),
        set: async (patch: Partial<typeof secure>) => {
          secure = { ...secure, ...patch };
          return { ...secure };
        },
      },
      dispatchEvent: () => true,
    },
  });

  try {
    assert.equal(await initializeVoiceSecrets(), true);
    assert.deepEqual(secure, {
      apiKey: 'legacy-openai-secret',
      sonioxApiKey: 'legacy-soniox-secret',
    });
    const stored = JSON.parse(localStorage.getItem('voiceConfig') ?? '{}') as Record<string, unknown>;
    assert.equal('apiKey' in stored, false);
    assert.equal('sonioxApiKey' in stored, false);
    assert.equal(readVoiceConfig().apiKey, 'legacy-openai-secret');
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
    resetVoiceSecretStateForTests();
  }
});

test('keeps legacy secrets when secure read-back does not match', async () => {
  resetVoiceSecretStateForTests();
  installStorage({ apiKey: 'do-not-lose-me' });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      cloudcliDesktopVoiceSecrets: {
        get: async () => ({ apiKey: '', sonioxApiKey: '' }),
        set: async () => ({ apiKey: '', sonioxApiKey: '' }),
      },
      dispatchEvent: () => true,
    },
  });
  try {
    await assert.rejects(initializeVoiceSecrets(), /read-back failed/i);
    const stored = JSON.parse(localStorage.getItem('voiceConfig') ?? '{}') as Record<string, unknown>;
    assert.equal(stored.apiKey, 'do-not-lose-me');
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
    resetVoiceSecretStateForTests();
  }
});
