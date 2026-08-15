import fs from 'node:fs/promises';
import path from 'node:path';

function readTokenExpiry(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return null;
  }

  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded.padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), '=');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function isUsableLocalAuthToken(token, now = Date.now()) {
  const expiresAt = readTokenExpiry(token);
  return expiresAt !== null && expiresAt > now;
}

export class LocalAuthStore {
  constructor(storePath) {
    this.storePath = storePath;
    this.token = null;
  }

  getToken() {
    if (!isUsableLocalAuthToken(this.token)) {
      this.token = null;
    }
    return this.token;
  }

  async load() {
    try {
      const record = JSON.parse(await fs.readFile(this.storePath, 'utf8'));
      this.token = isUsableLocalAuthToken(record?.token) ? record.token : null;
      if (!this.token) {
        await fs.rm(this.storePath, { force: true });
      }
    } catch {
      this.token = null;
    }
    return this.token;
  }

  async save(token) {
    if (!isUsableLocalAuthToken(token)) {
      this.token = null;
      await fs.rm(this.storePath, { force: true });
      return null;
    }

    this.token = token;
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, `${JSON.stringify({ token })}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.chmod(this.storePath, 0o600);
    return token;
  }
}
