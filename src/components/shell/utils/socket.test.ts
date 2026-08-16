import assert from 'node:assert/strict';
import test from 'node:test';

import { createShellInitMessage } from './socket';

test('primary Shell init carries only interactive mode, project id, dimensions, and restart intent', () => {
  const message = createShellInitMessage({
    mode: 'interactive-terminal',
    projectId: 'project-123',
    cols: 100,
    rows: 30,
    forceRestart: true,
  });

  assert.deepEqual(message, {
    type: 'init',
    mode: 'interactive-terminal',
    projectId: 'project-123',
    cols: 100,
    rows: 30,
    forceRestart: true,
  });
  assert.equal('projectPath' in message, false);
  assert.equal('sessionId' in message, false);
  assert.equal('provider' in message, false);
  assert.equal('initialCommand' in message, false);
});

test('command terminal keeps its command contract separate from project Shell', () => {
  assert.deepEqual(createShellInitMessage({
    mode: 'command-terminal',
    command: 'codex login',
    cols: 80,
    rows: 24,
  }), {
    type: 'init',
    mode: 'command-terminal',
    command: 'codex login',
    cols: 80,
    rows: 24,
  });
});
