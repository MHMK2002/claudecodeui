import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSystemLoginShell } from '@/shared/utils.js';

test('macOS resolves the configured executable as a direct login shell', () => {
  assert.deepEqual(resolveSystemLoginShell({
    platform: 'darwin',
    env: { SHELL: '/opt/homebrew/bin/fish' },
    isExecutable: (candidate) => candidate === '/opt/homebrew/bin/fish',
  }), { file: '/opt/homebrew/bin/fish', args: ['-l'] });
});

test('Linux falls back to bash and still avoids a command wrapper', () => {
  assert.deepEqual(resolveSystemLoginShell({
    platform: 'linux',
    env: { SHELL: '/missing/shell' },
    isExecutable: (candidate) => candidate === '/bin/bash',
  }), { file: '/bin/bash', args: ['-l'] });
});

test('Windows launches COMSPEC directly with no command arguments', () => {
  assert.deepEqual(resolveSystemLoginShell({
    platform: 'win32',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
  }), { file: 'C:\\Windows\\System32\\cmd.exe', args: [] });
});

test('POSIX reports an unavailable shell when no executable candidate exists', () => {
  assert.equal(resolveSystemLoginShell({
    platform: 'linux',
    env: {},
    isExecutable: () => false,
  }), null);
});
