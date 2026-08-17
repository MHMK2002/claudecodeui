import fs from 'node:fs';
import path from 'node:path';

import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { WebSocket, type RawData } from 'ws';

import { parseIncomingJsonObject, resolveSystemLoginShell } from '@/shared/utils.js';

type ShellIncomingMessage = {
  type?: string;
  mode?: string;
  projectId?: string;
  cols?: number;
  rows?: number;
  data?: string;
  forceRestart?: boolean;
  // Legacy trust-boundary fields are declared only so init can reject them.
  projectPath?: unknown;
  sessionId?: unknown;
  provider?: unknown;
  hasSession?: unknown;
  initialCommand?: unknown;
  isPlainShell?: unknown;
};

type ShellErrorCode =
  | 'INVALID_SHELL_REQUEST'
  | 'PROJECT_MISSING'
  | 'CWD_UNAVAILABLE'
  | 'SHELL_UNAVAILABLE'
  | 'SOCKET_FAILURE';

type ShellWebSocketDependencies = {
  resolveProjectPath: (projectId: string) => string | null;
  spawnPty?: typeof pty.spawn;
  resolveLoginShell?: typeof resolveSystemLoginShell;
  realpath?: (projectPath: string) => string;
  stat?: (projectPath: string) => fs.Stats;
};

type PtySessionEntry = {
  pty: IPty;
  ws: WebSocket | null;
  buffer: string[];
  bufferBytes: number;
  timeoutId: NodeJS.Timeout | null;
  projectId: string;
  cwd: string;
};

const ptySessions = new Map<string, PtySessionEntry>();
const PTY_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const PTY_BUFFER_LIMIT_BYTES = 1024 * 1024;
const INPUT_LIMIT_BYTES = 64 * 1024;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9._-]{1,120}$/;
const MIN_TERMINAL_DIMENSION = 2;
const MAX_TERMINAL_COLUMNS = 500;
const MAX_TERMINAL_ROWS = 300;
const LEGACY_INIT_FIELDS = [
  'projectPath',
  'sessionId',
  'provider',
  'hasSession',
  'initialCommand',
  'isPlainShell',
] as const;

function parseShellMessage(rawMessage: RawData): ShellIncomingMessage | null {
  const parsed = parseIncomingJsonObject(rawMessage);
  return parsed ? parsed as ShellIncomingMessage : null;
}

function readDimension(value: unknown, fallback: number, maximum: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(maximum, Math.max(MIN_TERMINAL_DIMENSION, Number(value)));
}

function sendFrame(ws: WebSocket, frame: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

function sendShellError(
  ws: WebSocket,
  code: ShellErrorCode,
  message: string,
  recovery: 'retry' | 'choose-project' | 'restart',
): void {
  sendFrame(ws, { type: 'error', code, message, recovery });
}

function hasLegacyInitField(message: ShellIncomingMessage): boolean {
  const record = message as Record<string, unknown>;
  return LEGACY_INIT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(record, field));
}

function appendBufferedOutput(session: PtySessionEntry, chunk: string): void {
  const chunkBytes = Buffer.byteLength(chunk);
  session.buffer.push(chunk);
  session.bufferBytes += chunkBytes;

  while (session.bufferBytes > PTY_BUFFER_LIMIT_BYTES && session.buffer.length > 1) {
    const removed = session.buffer.shift();
    if (removed) session.bufferBytes -= Buffer.byteLength(removed);
  }

  if (session.bufferBytes > PTY_BUFFER_LIMIT_BYTES && session.buffer.length === 1) {
    const retained = Buffer.from(session.buffer[0])
      .subarray(-PTY_BUFFER_LIMIT_BYTES)
      .toString('utf8');
    session.buffer = [retained];
    session.bufferBytes = Buffer.byteLength(retained);
  }
}

function clearRetentionTimer(session: PtySessionEntry): void {
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }
}

function killSession(sessionKey: string): void {
  const existing = ptySessions.get(sessionKey);
  if (!existing) return;
  clearRetentionTimer(existing);
  existing.pty.kill();
  ptySessions.delete(sessionKey);
}

function resolveCanonicalCwd(
  projectId: string,
  dependencies: ShellWebSocketDependencies,
): { cwd: string } | { error: 'PROJECT_MISSING' | 'CWD_UNAVAILABLE' } {
  let storedPath: string | null;
  try {
    storedPath = dependencies.resolveProjectPath(projectId);
  } catch {
    return { error: 'PROJECT_MISSING' };
  }
  if (!storedPath) {
    return { error: 'PROJECT_MISSING' };
  }

  try {
    const canonicalPath = (dependencies.realpath ?? fs.realpathSync)(storedPath);
    const stats = (dependencies.stat ?? fs.statSync)(canonicalPath);
    if (!stats.isDirectory()) {
      return { error: 'CWD_UNAVAILABLE' };
    }
    return { cwd: path.resolve(canonicalPath) };
  } catch {
    return { error: 'CWD_UNAVAILABLE' };
  }
}

/**
 * Owns the local interactive-terminal protocol. The client supplies only a
 * registered project id; provider/session ids and filesystem paths are never
 * accepted at this boundary. Consumed by the WebSocket gateway.
 */
export function handleShellConnection(
  ws: WebSocket,
  dependencies: ShellWebSocketDependencies,
  ownerKey = 'local-owner',
): void {
  let shellProcess: IPty | null = null;
  let activeSessionKey: string | null = null;

  ws.on('message', (rawMessage) => {
    try {
      const message = parseShellMessage(rawMessage);
      if (!message?.type) {
        sendShellError(ws, 'INVALID_SHELL_REQUEST', 'The terminal request is invalid.', 'retry');
        return;
      }

      if (message.type === 'init') {
        const projectId = typeof message.projectId === 'string' ? message.projectId.trim() : '';
        const sessionKey = `${ownerKey}:${projectId}`;
        if (
          message.mode !== 'interactive-terminal'
          || !PROJECT_ID_PATTERN.test(projectId)
          || hasLegacyInitField(message)
        ) {
          sendShellError(
            ws,
            'INVALID_SHELL_REQUEST',
            'Local Shell requires interactive-terminal mode and a registered project id.',
            'choose-project',
          );
          return;
        }
        if (activeSessionKey && activeSessionKey !== sessionKey) {
          sendShellError(
            ws,
            'INVALID_SHELL_REQUEST',
            'Open a new terminal connection when switching projects.',
            'choose-project',
          );
          return;
        }

        const cwdResult = resolveCanonicalCwd(projectId, dependencies);
        if ('error' in cwdResult) {
          killSession(sessionKey);
          if (cwdResult.error === 'PROJECT_MISSING') {
            sendShellError(
              ws,
              'PROJECT_MISSING',
              'This project is no longer registered. Choose another project.',
              'choose-project',
            );
          } else {
            sendShellError(
              ws,
              'CWD_UNAVAILABLE',
              'The registered project folder is unavailable. Restore or reopen the folder, then retry.',
              'retry',
            );
          }
          return;
        }

        activeSessionKey = sessionKey;
        if (message.forceRestart === true) {
          killSession(sessionKey);
        }

        const retainedSession = ptySessions.get(sessionKey);
        if (retainedSession && retainedSession.cwd !== cwdResult.cwd) {
          killSession(sessionKey);
        }
        const existing = ptySessions.get(sessionKey);
        if (existing) {
          shellProcess = existing.pty;
          clearRetentionTimer(existing);
          existing.ws = ws;
          sendFrame(ws, { type: 'ready', mode: 'interactive-terminal', projectId, reconnected: true });
          for (const chunk of existing.buffer) {
            sendFrame(ws, { type: 'output', data: chunk });
          }
          return;
        }

        const loginShell = (dependencies.resolveLoginShell ?? resolveSystemLoginShell)();
        if (!loginShell) {
          sendShellError(
            ws,
            'SHELL_UNAVAILABLE',
            'No supported system login shell is available.',
            'restart',
          );
          return;
        }

        const cols = readDimension(message.cols, 80, MAX_TERMINAL_COLUMNS);
        const rows = readDimension(message.rows, 24, MAX_TERMINAL_ROWS);
        try {
          shellProcess = (dependencies.spawnPty ?? pty.spawn)(loginShell.file, loginShell.args, {
            name: 'xterm-256color',
            cols,
            rows,
            cwd: cwdResult.cwd,
            env: {
              ...process.env,
              TERM: 'xterm-256color',
              COLORTERM: 'truecolor',
            },
          });
        } catch {
          shellProcess = null;
          sendShellError(
            ws,
            'SHELL_UNAVAILABLE',
            'The system login shell could not be started.',
            'restart',
          );
          return;
        }

        const session: PtySessionEntry = {
          pty: shellProcess,
          ws,
          buffer: [],
          bufferBytes: 0,
          timeoutId: null,
          projectId,
          cwd: cwdResult.cwd,
        };
        ptySessions.set(sessionKey, session);

        shellProcess.onData((chunk) => {
          const current = ptySessions.get(sessionKey);
          if (!current || current.pty !== shellProcess) return;
          appendBufferedOutput(current, chunk);
          if (current.ws) sendFrame(current.ws, { type: 'output', data: chunk });
        });

        shellProcess.onExit(({ exitCode, signal }) => {
          const current = ptySessions.get(sessionKey);
          if (!current || current.pty !== shellProcess) return;
          clearRetentionTimer(current);
          if (current.ws) {
            sendFrame(current.ws, { type: 'exit', exitCode, signal: signal ?? null });
          }
          ptySessions.delete(sessionKey);
          shellProcess = null;
        });

        sendFrame(ws, { type: 'ready', mode: 'interactive-terminal', projectId, reconnected: false });
        return;
      }

      if (message.type === 'input') {
        if (!shellProcess || typeof message.data !== 'string') return;
        if (Buffer.byteLength(message.data) > INPUT_LIMIT_BYTES) {
          sendShellError(ws, 'INVALID_SHELL_REQUEST', 'Terminal input is too large.', 'retry');
          return;
        }
        shellProcess.write(message.data);
        return;
      }

      if (message.type === 'resize') {
        if (!shellProcess) return;
        shellProcess.resize(
          readDimension(message.cols, 80, MAX_TERMINAL_COLUMNS),
          readDimension(message.rows, 24, MAX_TERMINAL_ROWS),
        );
        return;
      }

      sendShellError(ws, 'INVALID_SHELL_REQUEST', 'Unknown terminal request.', 'retry');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Shell] WebSocket failure:', message);
      sendShellError(ws, 'SOCKET_FAILURE', 'The terminal connection failed. Reconnect and retry.', 'retry');
    }
  });

  ws.on('close', () => {
    if (!activeSessionKey) return;
    const session = ptySessions.get(activeSessionKey);
    if (!session || session.ws !== ws) return;

    session.ws = null;
    clearRetentionTimer(session);
    session.timeoutId = setTimeout(() => {
      if (ptySessions.get(activeSessionKey as string) !== session || session.ws !== null) return;
      session.pty.kill();
      ptySessions.delete(activeSessionKey as string);
    }, PTY_SESSION_TIMEOUT_MS);
  });

  ws.on('error', (error) => {
    console.error('[Shell] WebSocket error:', error);
  });
}
