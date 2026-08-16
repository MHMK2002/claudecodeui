import os from 'node:os';

import pty, { type IPty } from 'node-pty';
import { WebSocket, type RawData } from 'ws';

import { parseIncomingJsonObject, resolveSystemLoginShell } from '@/shared/utils.js';

type CommandTerminalMessage = {
  type?: string;
  mode?: string;
  command?: string;
  cols?: number;
  rows?: number;
  data?: string;
};

type CommandTerminalDependencies = {
  spawnPty?: typeof pty.spawn;
  resolveLoginShell?: typeof resolveSystemLoginShell;
};

const COMMAND_LIMIT_BYTES = 16 * 1024;
const INPUT_LIMIT_BYTES = 64 * 1024;
const AUTH_URL_PATTERN = /https?:\/\/[^\s<>"'`\\\x1b\x07]+/gi;
const TRAILING_URL_PUNCTUATION = /[)\]}>.,;:!?]+$/;

function parseMessage(rawMessage: RawData): CommandTerminalMessage | null {
  const parsed = parseIncomingJsonObject(rawMessage);
  return parsed ? parsed as CommandTerminalMessage : null;
}

function sendFrame(ws: WebSocket, frame: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

function readDimension(value: unknown, fallback: number, max: number): number {
  return Number.isInteger(value) ? Math.min(max, Math.max(2, Number(value))) : fallback;
}

function normalizeHttpUrl(candidate: string): string | null {
  try {
    const parsed = new URL(candidate.replace(TRAILING_URL_PUNCTUATION, ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Builds the command + completion marker written into the already-running login shell. */
export function buildCommandTerminalInput(
  command: string,
  shellFile: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    if (/(^|[\\/])cmd(?:\.exe)?$/i.test(shellFile)) {
      return `${command} & echo Process exited with code %ERRORLEVEL%\r`;
    }
    return `${command}; Write-Output \"Process exited with code $LASTEXITCODE\"\r`;
  }
  return `${command}; printf '\\r\\nProcess exited with code %s\\r\\n' \"$?\"\r`;
}

/**
 * Runs explicit setup/login commands on the separate loopback-only command
 * terminal. Provider authentication URL detection lives here so the primary
 * local Shell remains a plain project terminal. Consumed by the WebSocket gateway.
 */
export function handleCommandTerminalConnection(
  ws: WebSocket,
  dependencies: CommandTerminalDependencies,
): void {
  let processHandle: IPty | null = null;
  const announcedUrls = new Set<string>();

  ws.on('message', (rawMessage) => {
    const message = parseMessage(rawMessage);
    if (!message?.type) {
      sendFrame(ws, { type: 'error', code: 'INVALID_COMMAND_TERMINAL_REQUEST', message: 'Invalid terminal request.' });
      return;
    }

    if (message.type === 'init') {
      const command = typeof message.command === 'string' ? message.command.trim() : '';
      if (
        message.mode !== 'command-terminal'
        || !command
        || Buffer.byteLength(command) > COMMAND_LIMIT_BYTES
        || command.includes('\0')
      ) {
        sendFrame(ws, {
          type: 'error',
          code: 'INVALID_COMMAND_TERMINAL_REQUEST',
          message: 'A valid setup command is required.',
        });
        return;
      }

      const loginShell = (dependencies.resolveLoginShell ?? resolveSystemLoginShell)();
      if (!loginShell) {
        sendFrame(ws, { type: 'error', code: 'SHELL_UNAVAILABLE', message: 'No system login shell is available.' });
        return;
      }

      try {
        processHandle = (dependencies.spawnPty ?? pty.spawn)(loginShell.file, loginShell.args, {
          name: 'xterm-256color',
          cols: readDimension(message.cols, 80, 500),
          rows: readDimension(message.rows, 24, 300),
          cwd: os.homedir(),
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
          },
        });
      } catch {
        processHandle = null;
        sendFrame(ws, { type: 'error', code: 'SHELL_UNAVAILABLE', message: 'The command terminal could not start.' });
        return;
      }

      processHandle.onData((chunk) => {
        sendFrame(ws, { type: 'output', data: chunk });
        for (const candidate of chunk.match(AUTH_URL_PATTERN) ?? []) {
          const url = normalizeHttpUrl(candidate);
          if (!url || announcedUrls.has(url)) continue;
          announcedUrls.add(url);
          sendFrame(ws, { type: 'auth_url', url, autoOpen: false });
        }
      });
      processHandle.onExit(({ exitCode, signal }) => {
        sendFrame(ws, { type: 'exit', exitCode, signal: signal ?? null });
        processHandle = null;
      });

      sendFrame(ws, { type: 'ready', mode: 'command-terminal' });
      processHandle.write(buildCommandTerminalInput(command, loginShell.file));
      return;
    }

    if (message.type === 'input' && processHandle && typeof message.data === 'string') {
      if (Buffer.byteLength(message.data) <= INPUT_LIMIT_BYTES) processHandle.write(message.data);
      return;
    }

    if (message.type === 'resize' && processHandle) {
      processHandle.resize(
        readDimension(message.cols, 80, 500),
        readDimension(message.rows, 24, 300),
      );
    }
  });

  ws.on('close', () => {
    processHandle?.kill();
    processHandle = null;
  });

  ws.on('error', (error) => {
    console.error('[CommandTerminal] WebSocket error:', error);
  });
}
