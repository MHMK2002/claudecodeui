import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { WebSocket } from 'ws';

import {
  buildCommandTerminalInput,
  handleCommandTerminalConnection,
} from '@/modules/websocket/services/command-terminal-websocket.service.js';

function createSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: string[];
    send: (data: string) => void;
  };
  socket.readyState = WebSocket.OPEN;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(data);
  return socket;
}

test('command terminal isolates provider login URL detection from local Shell', () => {
  const socket = createSocket();
  const writes: string[] = [];
  let dataListener: ((data: string) => void) | null = null;
  const fakePty = {
    onData(listener: (data: string) => void) {
      dataListener = listener;
      return { dispose() {} };
    },
    onExit() {
      return { dispose() {} };
    },
    emitData(value: string) {
      dataListener?.(value);
    },
    write(value: string) {
      writes.push(value);
    },
    resize() {},
    kill() {},
  };
  const spawnCalls: Array<{ file: string; args: string | string[] }> = [];

  handleCommandTerminalConnection(socket as never, {
    resolveLoginShell: () => ({ file: '/bin/zsh', args: ['-l'] }),
    spawnPty: ((file: string, args: string | string[]) => {
      spawnCalls.push({ file, args });
      return fakePty;
    }) as never,
  });
  socket.emit('message', JSON.stringify({
    type: 'init',
    mode: 'command-terminal',
    command: 'codex login',
    cols: 80,
    rows: 24,
  }));

  assert.deepEqual(spawnCalls, [{ file: '/bin/zsh', args: ['-l'] }]);
  assert.equal(Array.isArray(spawnCalls[0].args) && spawnCalls[0].args.includes('-c'), false);
  assert.match(writes[0], /^codex login;/);

  fakePty.emitData('Continue at https://example.com/device?code=abc\r\n');
  const frames = socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>);
  assert.equal(frames.some((frame) => frame.type === 'ready'), true);
  assert.deepEqual(frames.find((frame) => frame.type === 'auth_url'), {
    type: 'auth_url',
    url: 'https://example.com/device?code=abc',
    autoOpen: false,
  });
});

test('command completion markers match cmd.exe, PowerShell, and POSIX syntax', () => {
  assert.equal(
    buildCommandTerminalInput('codex login', 'C:\\Windows\\System32\\cmd.exe', 'win32'),
    'codex login & echo Process exited with code %ERRORLEVEL%\r',
  );
  assert.equal(
    buildCommandTerminalInput('codex login', 'powershell.exe', 'win32'),
    'codex login; Write-Output "Process exited with code $LASTEXITCODE"\r',
  );
  assert.match(
    buildCommandTerminalInput('codex login', '/bin/zsh', 'darwin'),
    /^codex login; printf/,
  );
});
