import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createVoiceSecureStorage } from '../../electron/voiceSecureStorage.js';

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${[...value].reverse().join('')}`, 'utf8'),
  decryptString: (value) => {
    const encoded = value.toString('utf8');
    assert.ok(encoded.startsWith('encrypted:'));
    return [...encoded.slice('encrypted:'.length)].reverse().join('');
  },
};

test('Voice secrets are encrypted, verified by read-back, and deletable', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'voice-secure-storage-'));
  const storePath = path.join(directory, 'voice-secrets.json');
  try {
    const storage = createVoiceSecureStorage({ storePath, safeStorage: fakeSafeStorage });
    const written = await storage.write({ apiKey: 'sk-local-secret', sonioxApiKey: 'soniox-local-secret' });
    assert.deepEqual(written, { apiKey: 'sk-local-secret', sonioxApiKey: 'soniox-local-secret' });
    const raw = await readFile(storePath, 'utf8');
    assert.doesNotMatch(raw, /sk-local-secret|soniox-local-secret/);
    assert.deepEqual(await storage.read(), written);

    assert.deepEqual(await storage.write({ apiKey: '' }), {
      apiKey: '',
      sonioxApiKey: 'soniox-local-secret',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Voice secrets never fall back to plaintext when OS encryption is unavailable', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'voice-secure-storage-disabled-'));
  const storePath = path.join(directory, 'voice-secrets.json');
  try {
    const storage = createVoiceSecureStorage({
      storePath,
      safeStorage: { ...fakeSafeStorage, isEncryptionAvailable: () => false },
    });
    await assert.rejects(storage.write({ apiKey: 'must-not-be-plain' }), /secure storage is unavailable/i);
    await assert.rejects(readFile(storePath, 'utf8'), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('local preload exposes only the narrow Voice secret bridge', async () => {
  const preload = await readFile(path.resolve('electron/preload.cjs'), 'utf8');
  assert.match(preload, /cloudcliDesktopVoiceSecrets/);
  assert.match(preload, /get-voice-secrets/);
  assert.match(preload, /set-voice-secrets/);
  assert.doesNotMatch(preload, /safeStorage|voice-secrets\.json/);
});
