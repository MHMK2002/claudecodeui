import type { MutableRefObject, RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';

import type { Project } from '../../../types/app';

export type ShellTerminalMode = 'interactive-terminal' | 'command-terminal';

export type InteractiveShellInitMessage = {
  type: 'init';
  mode: 'interactive-terminal';
  projectId: string;
  cols: number;
  rows: number;
  forceRestart?: boolean;
};

export type CommandTerminalInitMessage = {
  type: 'init';
  mode: 'command-terminal';
  command: string;
  cols: number;
  rows: number;
};

export type ShellResizeMessage = {
  type: 'resize';
  cols: number;
  rows: number;
};

export type ShellInputMessage = {
  type: 'input';
  data: string;
};

export type ShellOutgoingMessage =
  | InteractiveShellInitMessage
  | CommandTerminalInitMessage
  | ShellResizeMessage
  | ShellInputMessage;

export type ShellConnectionError = {
  code:
    | 'INVALID_SHELL_REQUEST'
    | 'PROJECT_MISSING'
    | 'CWD_UNAVAILABLE'
    | 'SHELL_UNAVAILABLE'
    | 'SOCKET_FAILURE'
    | 'INVALID_COMMAND_TERMINAL_REQUEST'
    | 'UNKNOWN';
  message: string;
  recovery: 'retry' | 'choose-project' | 'restart';
};

export type ShellIncomingMessage =
  | { type: 'ready'; mode: ShellTerminalMode; projectId?: string; reconnected?: boolean }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number; signal?: number | null }
  | { type: 'error'; code?: string; message?: string; recovery?: string }
  | { type: 'auth_url'; url?: string; autoOpen?: boolean };

export type UseShellRuntimeOptions = {
  selectedProject: Project | null | undefined;
  command: string | null | undefined;
  minimal: boolean;
  autoConnect: boolean;
  isRestarting: boolean;
  onProcessComplete?: ((exitCode: number) => void) | null;
  onOutputRef?: MutableRefObject<(() => void) | null>;
};

export type UseShellRuntimeResult = {
  terminalContainerRef: RefObject<HTMLDivElement>;
  terminalRef: MutableRefObject<Terminal | null>;
  wsRef: MutableRefObject<WebSocket | null>;
  isConnected: boolean;
  isInitialized: boolean;
  isConnecting: boolean;
  connectionError: ShellConnectionError | null;
  connectToShell: (options?: { forceRestart?: boolean }) => void;
  disconnectFromShell: (options?: { suppressAutoConnect?: boolean }) => void;
};
