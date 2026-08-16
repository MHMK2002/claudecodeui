import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import test from 'node:test';

import pty from 'node-pty';
import { WebSocket } from 'ws';

import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';

function createFakeSocket() {
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

function createFakePty() {
  let dataListener: ((data: string) => void) | null = null;
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null;
  const writes: string[] = [];
  const resizes: Array<[number, number]> = [];

  return {
    killed: false,
    writes,
    resizes,
    onData(listener: (data: string) => void) {
      dataListener = listener;
      return { dispose: () => undefined };
    },
    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      exitListener = listener;
      return { dispose: () => undefined };
    },
    emitData(data: string) {
      dataListener?.(data);
    },
    emitExit(exitCode = 0) {
      exitListener?.({ exitCode });
    },
    write(data: string) {
      writes.push(data);
    },
    resize(cols: number, rows: number) {
      resizes.push([cols, rows]);
    },
    kill() {
      this.killed = true;
    },
  };
}

function createDependencies(ptyProcess = createFakePty()) {
  const spawnCalls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
  return {
    ptyProcess,
    spawnCalls,
    dependencies: {
      resolveProjectPath: () => process.cwd(),
      resolveLoginShell: () => ({ file: '/bin/zsh', args: ['-l'] }),
      realpath: (value: string) => value,
      stat: (value: string) => fs.statSync(value),
      spawnPty: (
        file: string,
        args: string | string[],
        options: Parameters<typeof pty.spawn>[2],
      ) => {
        spawnCalls.push({
          file,
          args: Array.isArray(args) ? args : [args],
          options: options as unknown as Record<string, unknown>,
        });
        return ptyProcess as unknown as ReturnType<typeof pty.spawn>;
      },
    },
  };
}

function initMessage(projectId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'init',
    mode: 'interactive-terminal',
    projectId,
    cols: 100,
    rows: 30,
    ...extra,
  });
}

test('interactive terminal resolves cwd by project id and launches the OS login shell directly', () => {
  const socket = createFakeSocket();
  const fixture = createDependencies();
  const projectId = `direct-login-${Date.now()}`;

  handleShellConnection(socket as never, fixture.dependencies);
  socket.emit('message', initMessage(projectId));

  assert.equal(fixture.spawnCalls.length, 1);
  assert.equal(fixture.spawnCalls[0].file, '/bin/zsh');
  assert.deepEqual(fixture.spawnCalls[0].args, ['-l']);
  assert.equal(fixture.spawnCalls[0].args.includes('-c'), false);
  assert.equal(fixture.spawnCalls[0].options.cwd, process.cwd());
  assert.equal(socket.frames.some((frame) => JSON.parse(frame).type === 'ready'), true);

  socket.emit('message', JSON.stringify({ type: 'input', data: 'pwd\r' }));
  socket.emit('message', JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
  assert.deepEqual(fixture.ptyProcess.writes, ['pwd\r']);
  assert.deepEqual(fixture.ptyProcess.resizes, [[120, 40]]);
  fixture.ptyProcess.emitExit();
});

test('interactive terminal rejects client paths and provider/session fields before spawning', () => {
  const socket = createFakeSocket();
  const fixture = createDependencies();

  handleShellConnection(socket as never, fixture.dependencies);
  socket.emit('message', initMessage('reject-legacy', {
    projectPath: '/tmp/forged',
    provider: 'claude',
    sessionId: 'provider-session',
  }));

  assert.equal(fixture.spawnCalls.length, 0);
  const error = JSON.parse(socket.frames[0]) as Record<string, unknown>;
  assert.equal(error.type, 'error');
  assert.equal(error.code, 'INVALID_SHELL_REQUEST');
});

test('local Shell treats login-looking URLs as terminal output only', () => {
  const socket = createFakeSocket();
  const fixture = createDependencies();
  handleShellConnection(socket as never, fixture.dependencies);
  socket.emit('message', initMessage(`plain-output-${Date.now()}`));
  socket.frames.length = 0;

  fixture.ptyProcess.emitData('Open this URL: https://example.com/device?code=abc\r\n');

  const frames = socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>);
  assert.deepEqual(frames.map((frame) => frame.type), ['output']);
  fixture.ptyProcess.emitExit();
});

test('missing project, unavailable cwd, and unavailable shell have distinct recovery codes', () => {
  const cases = [
    {
      id: 'missing-project',
      dependencies: { ...createDependencies().dependencies, resolveProjectPath: () => null },
      code: 'PROJECT_MISSING',
    },
    {
      id: 'missing-cwd',
      dependencies: { ...createDependencies().dependencies, resolveProjectPath: () => '/does/not/exist' },
      code: 'CWD_UNAVAILABLE',
    },
    {
      id: 'missing-shell',
      dependencies: { ...createDependencies().dependencies, resolveLoginShell: () => null },
      code: 'SHELL_UNAVAILABLE',
    },
  ];

  for (const fixture of cases) {
    const socket = createFakeSocket();
    handleShellConnection(socket as never, fixture.dependencies);
    socket.emit('message', initMessage(`${fixture.id}-${Date.now()}`));
    const error = socket.frames.map((frame) => JSON.parse(frame)).find((frame) => frame.type === 'error');
    assert.equal(error?.code, fixture.code);
    assert.equal(typeof error?.recovery, 'string');
  }
});

test('a stale socket close cannot detach the socket that replaced it', () => {
  const fixture = createDependencies();
  const projectId = `stale-close-${Date.now()}`;
  const firstSocket = createFakeSocket();
  handleShellConnection(firstSocket as never, fixture.dependencies);
  firstSocket.emit('message', initMessage(projectId));

  const replacementSocket = createFakeSocket();
  handleShellConnection(replacementSocket as never, fixture.dependencies);
  replacementSocket.emit('message', initMessage(projectId));
  replacementSocket.frames.length = 0;

  firstSocket.emit('close');
  fixture.ptyProcess.emitData('output-after-stale-close');

  assert.equal(fixture.ptyProcess.killed, false);
  assert.equal(replacementSocket.frames.length, 1);
  assert.match(replacementSocket.frames[0], /output-after-stale-close/);
  fixture.ptyProcess.emitExit();
});

test('retained terminals are isolated by authenticated owner as well as project id', () => {
  const projectId = `owner-isolation-${Date.now()}`;
  const first = createDependencies();
  const second = createDependencies();
  const firstSocket = createFakeSocket();
  const secondSocket = createFakeSocket();

  handleShellConnection(firstSocket as never, first.dependencies, 'owner-a');
  handleShellConnection(secondSocket as never, second.dependencies, 'owner-b');
  firstSocket.emit('message', initMessage(projectId));
  secondSocket.emit('message', initMessage(projectId));

  assert.equal(first.spawnCalls.length, 1);
  assert.equal(second.spawnCalls.length, 1);
  first.ptyProcess.emitExit();
  second.ptyProcess.emitExit();
});
