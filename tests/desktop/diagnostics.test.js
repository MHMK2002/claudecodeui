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
    email: 'person@example.com',
    projectName: 'private-project',
    appPath: '/Users/person/work/private-project',
  });

  assert.equal(redacted.token, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(redacted), /top-secret|secret-code|abc\.def\.ghi|person@example\.com|private-project|\/Users\/person/);
  assert.equal(redacted.url, '[REDACTED_LOCAL_URL]');
});

test('desktop diagnostics redact embedded local URLs and platform paths in startup lines', () => {
  const redacted = [
    'cwd: /opt/cloudcli/server',
    '$ /Applications/CloudCLI.app/Contents/MacOS/CloudCLI /private/tmp/server.js',
    'Using existing at http://localhost:3001/workspace?project=private',
    'runtime C:\\Program Files\\CloudCLI\\server.exe',
  ].map((line) => redactDiagnosticValue(line)).join('\n');

  assert.doesNotMatch(redacted, /\/opt\/cloudcli|\/Applications\/CloudCLI|\/private\/tmp|localhost:3001|Program Files/i);
  assert.match(redacted, /\[REDACTED_PATH\]/);
  assert.match(redacted, /\[REDACTED_LOCAL_URL\]/);
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
