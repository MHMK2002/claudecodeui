import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DesktopDiagnostics, redactDiagnosticValue } from '../../electron/diagnostics.js';

test('desktop diagnostics redact credentials and sensitive URL parameters', () => {
  const redacted = redactDiagnosticValue({
    token: 'top-secret',
    message: 'Authorization: Bearer abc.def.ghi',
    url: 'http://localhost:3001/callback?code=secret-code&view=chat',
  });

  assert.equal(redacted.token, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(redacted), /top-secret|secret-code|abc\.def\.ghi/);
  assert.match(redacted.url, /view=chat/);
});

test('desktop diagnostics rotate within a fixed file bound and return a sanitized tail', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-diagnostics-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const diagnostics = new DesktopDiagnostics({ directory, maxBytes: 240, maxFiles: 2 });

  for (let index = 0; index < 8; index += 1) {
    await diagnostics.record('test.event', {
      index,
      apiKey: `secret-${index}`,
      line: 'x'.repeat(80),
    });
  }

  const files = await fs.readdir(directory);
  const tail = await diagnostics.tail(20);
  assert.deepEqual(files.sort(), ['desktop.jsonl', 'desktop.jsonl.1']);
  assert.ok(tail.length > 0);
  assert.doesNotMatch(tail.join('\n'), /secret-/);
  assert.equal((await fs.stat(diagnostics.getPath())).mode & 0o777, 0o600);
});
