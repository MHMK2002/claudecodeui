import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_FILES = 3;
const MAX_STRING_LENGTH = 16 * 1024;
const SENSITIVE_KEY = /(?:authorization|cookie|credential|nonce|password|secret|token|api[_-]?key|email|activeTarget|project(?:Name|Path)?|(?:app|userData|diagnostics|cloudAccount)Path|local(?:Server|Web)?(?:Url|Port)|shareableWebUrl)/i;
const SENSITIVE_QUERY_KEY = /^(?:access_token|api_key|auth|authorization|code|credential|key|nonce|password|refresh_token|secret|token)$/i;

function redactUrl(value) {
  try {
    const url = new URL(value);
    if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
      return '[REDACTED_LOCAL_URL]';
    }
    let changed = false;
    for (const key of url.searchParams.keys()) {
      if (!SENSITIVE_QUERY_KEY.test(key)) continue;
      url.searchParams.set(key, '[REDACTED]');
      changed = true;
    }
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

export function redactDiagnosticValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    const shortened = value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]`
      : value;
    return redactUrl(shortened)
      .replace(/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[?::1\]?)(?::[0-9]+)?[^\s"'`)]*/gi, '[REDACTED_LOCAL_URL]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
      .replace(/\bfile:\/\/\/[^\s)]+/gi, '[REDACTED_PATH]')
      .replace(/(?:^|[\s"'`(])\/(?:Users|home)\/[^\s"'`),]+/gm, (match) => `${match[0]}[REDACTED_PATH]`)
      .replace(/(^|[\s"'`(=:])\/(?!\/)[^\s"'`),;]+/gm, '$1[REDACTED_PATH]')
      .replace(/\b[A-Za-z]:\\[^\s"'`),;]+/g, '[REDACTED_PATH]')
      .replace(/((?:authorization|cookie|password|secret|token|api[_-]?key|email|project(?:[-_ ]?name)?|local[-_ ]?url|path)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  }
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return redactDiagnosticValue({ name: value.name, message: value.message, stack: value.stack }, seen);
  }
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.slice(0, 100).map((item) => redactDiagnosticValue(item, seen));
    seen.delete(value);
    return result;
  }

  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactDiagnosticValue(item, seen);
  }
  seen.delete(value);
  return result;
}

export class DesktopDiagnostics {
  constructor({ directory, maxBytes = DEFAULT_MAX_BYTES, maxFiles = DEFAULT_MAX_FILES }) {
    this.directory = directory;
    this.filePath = path.join(directory, 'desktop.jsonl');
    this.maxBytes = maxBytes;
    this.maxFiles = Math.max(1, maxFiles);
    this.writeQueue = Promise.resolve();
  }

  getPath() {
    return this.filePath;
  }

  record(event, details = {}) {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      event: String(event || 'unknown'),
      details: redactDiagnosticValue(details),
    });
    this.writeQueue = this.writeQueue
      .then(() => this.#append(`${entry}\n`))
      .catch((error) => {
        console.error('[Diagnostics] Could not persist event:', error?.message || error);
      });
    return this.writeQueue;
  }

  async flush() {
    await this.writeQueue;
  }

  async tail(maxLines = 120) {
    await this.flush();
    const lines = [];
    for (let index = this.maxFiles - 1; index >= 0; index -= 1) {
      const filePath = index === 0 ? this.filePath : `${this.filePath}.${index}`;
      try {
        const content = await fs.readFile(filePath, 'utf8');
        lines.push(...content.split(/\r?\n/).filter(Boolean));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return lines.slice(-Math.max(1, maxLines)).map((line) => {
      try {
        return JSON.stringify(redactDiagnosticValue(JSON.parse(line)));
      } catch {
        return String(redactDiagnosticValue(line));
      }
    });
  }

  async #append(line) {
    await fs.mkdir(this.directory, { recursive: true });
    let size = 0;
    try {
      size = (await fs.stat(this.filePath)).size;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (size > 0 && size + Buffer.byteLength(line) > this.maxBytes) {
      await this.#rotate();
    }
    await fs.appendFile(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(this.filePath, 0o600).catch(() => {});
  }

  async #rotate() {
    if (this.maxFiles === 1) {
      await fs.rm(this.filePath, { force: true });
      return;
    }
    await fs.rm(`${this.filePath}.${this.maxFiles - 1}`, { force: true });
    for (let index = this.maxFiles - 2; index >= 1; index -= 1) {
      await fs.rename(`${this.filePath}.${index}`, `${this.filePath}.${index + 1}`).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
    await fs.rename(this.filePath, `${this.filePath}.1`).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}
