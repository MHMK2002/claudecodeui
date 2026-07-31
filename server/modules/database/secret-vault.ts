import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getDatabasePath } from '@/modules/database/connection.js';

const SECRET_PREFIX = 'enc:v1:';

let cachedKey: Buffer | null = null;

function getKeyFilePath(): string {
  return process.env.CLOUDCLI_SECRET_KEY_PATH
    || path.join(path.dirname(getDatabasePath()), 'provider-profiles.key');
}

function readOrCreateKeyMaterial(): string {
  const envSecret = process.env.CLOUDCLI_SECRET_KEY?.trim();
  if (envSecret) {
    return envSecret;
  }

  const keyPath = getKeyFilePath();
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf8').trim();
  }

  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const keyMaterial = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(keyPath, `${keyMaterial}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    // Best effort on platforms that do not support POSIX modes.
  }
  return keyMaterial;
}

function getEncryptionKey(): Buffer {
  if (!cachedKey) {
    cachedKey = crypto.createHash('sha256').update(readOrCreateKeyMaterial()).digest();
  }
  return cachedKey;
}

export function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    SECRET_PREFIX.slice(0, -1),
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSecret(storedSecret: string): string {
  if (!storedSecret.startsWith(SECRET_PREFIX)) {
    return storedSecret;
  }

  const [, version, ivRaw, tagRaw, ciphertextRaw] = storedSecret.split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('Unsupported encrypted secret format.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivRaw, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
