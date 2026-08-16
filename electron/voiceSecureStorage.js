import fs from 'node:fs/promises';
import path from 'node:path';

const VOICE_SECRET_KEYS = new Set(['apiKey', 'sonioxApiKey']);

function emptySecrets() {
  return { apiKey: '', sonioxApiKey: '' };
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Voice secret update must be an object.');
  }
  const normalized = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!VOICE_SECRET_KEYS.has(key)) throw new Error(`Unsupported voice secret key: ${key}`);
    if (typeof value !== 'string' || value.length > 16_384) {
      throw new Error(`Voice secret ${key} must be a string of at most 16384 characters.`);
    }
    normalized[key] = value;
  }
  return normalized;
}

/** Encrypted on-device Voice secret store used only by trusted local renderer IPC. */
export function createVoiceSecureStorage({ storePath, safeStorage, fileSystem = fs }) {
  if (!storePath || !safeStorage) throw new Error('Voice secure storage requires a path and encryption adapter.');

  const readRecords = async () => {
    let raw;
    try {
      raw = await fileSystem.readFile(storePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return {};
      throw new Error('Secure Voice storage could not be read.');
    }
    try {
      const payload = JSON.parse(raw);
      if (payload?.version !== 1 || !payload.values || typeof payload.values !== 'object') {
        throw new Error('invalid schema');
      }
      return payload.values;
    } catch {
      throw new Error('Secure Voice storage is corrupted.');
    }
  };

  const read = async () => {
    const records = await readRecords();
    const result = emptySecrets();
    for (const key of VOICE_SECRET_KEYS) {
      const record = records[key];
      if (!record) continue;
      if (record.encrypted !== true || typeof record.value !== 'string') {
        throw new Error('Secure Voice storage contains an invalid secret record.');
      }
      try {
        result[key] = safeStorage.decryptString(Buffer.from(record.value, 'base64'));
      } catch {
        throw new Error('Secure Voice storage could not decrypt its contents.');
      }
    }
    return result;
  };

  return {
    read,

    async write(patch) {
      const normalized = validatePatch(patch);
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Operating-system secure storage is unavailable.');
      }
      const records = await readRecords();
      for (const [key, value] of Object.entries(normalized)) {
        if (!value) {
          delete records[key];
          continue;
        }
        records[key] = {
          encrypted: true,
          value: safeStorage.encryptString(value).toString('base64'),
        };
      }
      await fileSystem.mkdir(path.dirname(storePath), { recursive: true });
      const temporaryPath = `${storePath}.${process.pid}.tmp`;
      await fileSystem.writeFile(
        temporaryPath,
        JSON.stringify({ version: 1, values: records }, null, 2),
        { encoding: 'utf8', mode: 0o600 },
      );
      await fileSystem.rename(temporaryPath, storePath);
      const readBack = await read();
      for (const [key, value] of Object.entries(normalized)) {
        if (readBack[key] !== value) throw new Error('Secure Voice storage read-back verification failed.');
      }
      return readBack;
    },
  };
}
