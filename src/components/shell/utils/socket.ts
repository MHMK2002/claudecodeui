import type {
  ShellOutgoingMessage,
  ShellIncomingMessage,
  ShellTerminalMode,
} from '../types/types';

type ShellInitInput = {
  mode: ShellTerminalMode;
  projectId?: string;
  command?: string;
  cols: number;
  rows: number;
  forceRestart?: boolean;
};

/** Builds the exact trust-boundary payload for local versus command terminals. */
export function createShellInitMessage(input: ShellInitInput): ShellOutgoingMessage {
  if (input.mode === 'command-terminal') {
    return {
      type: 'init',
      mode: 'command-terminal',
      command: input.command ?? '',
      cols: input.cols,
      rows: input.rows,
    };
  }
  return {
    type: 'init',
    mode: 'interactive-terminal',
    projectId: input.projectId ?? '',
    cols: input.cols,
    rows: input.rows,
    forceRestart: input.forceRestart || undefined,
  };
}

export function getShellWebSocketUrl(mode: ShellTerminalMode): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const pathname = mode === 'command-terminal' ? '/command-terminal' : '/shell';
  return `${protocol}//${window.location.host}${pathname}`;
}

export function parseShellMessage(payload: string): ShellIncomingMessage | null {
  try {
    return JSON.parse(payload) as ShellIncomingMessage;
  } catch {
    return null;
  }
}

export function sendSocketMessage(ws: WebSocket | null, message: ShellOutgoingMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
