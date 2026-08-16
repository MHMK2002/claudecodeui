import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

import type { Project } from '../../../types/app';
import type { RuntimeMode } from '../../auth/types';
import {
  AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT,
  renewDesktopLocalSession,
} from '../../../utils/api';
import type {
  ShellConnectionError,
  ShellIncomingMessage,
  ShellTerminalMode,
} from '../types/types';
import {
  createShellInitMessage,
  getShellWebSocketUrl,
  parseShellMessage,
  sendSocketMessage,
} from '../utils/socket';

const ANSI_ESCAPE_REGEX =
  /(?:\u001B\[[0-?]*[ -/]*[@-~]|\u009B[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u009D[^\u0007\u009C]*(?:\u0007|\u009C)|\u001B[PX^_][^\u001B]*\u001B\\|[\u0090\u0098\u009E\u009F][^\u009C]*\u009C|\u001B[@-Z\\-_])/g;
const PROCESS_EXIT_REGEX = /Process exited with code (-?\d+)/;

type UseShellConnectionOptions = {
  wsRef: MutableRefObject<WebSocket | null>;
  terminalRef: MutableRefObject<Terminal | null>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  selectedProjectRef: MutableRefObject<Project | null | undefined>;
  commandRef: MutableRefObject<string | null | undefined>;
  onProcessCompleteRef: MutableRefObject<((exitCode: number) => void) | null | undefined>;
  isInitialized: boolean;
  autoConnect: boolean;
  runtimeMode: RuntimeMode | null;
  closeSocket: () => void;
  clearTerminalScreen: () => void;
  onOutputRef?: MutableRefObject<(() => void) | null>;
};

type UseShellConnectionResult = {
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: ShellConnectionError | null;
  connectToShell: (options?: { forceRestart?: boolean }) => void;
  disconnectFromShell: (options?: { suppressAutoConnect?: boolean }) => void;
};

function normalizeConnectionError(message: Extract<ShellIncomingMessage, { type: 'error' }>): ShellConnectionError {
  const knownCodes = new Set<ShellConnectionError['code']>([
    'INVALID_SHELL_REQUEST',
    'PROJECT_MISSING',
    'CWD_UNAVAILABLE',
    'SHELL_UNAVAILABLE',
    'SOCKET_FAILURE',
    'INVALID_COMMAND_TERMINAL_REQUEST',
  ]);
  const code = knownCodes.has(message.code as ShellConnectionError['code'])
    ? message.code as ShellConnectionError['code']
    : 'UNKNOWN';
  const recovery = message.recovery === 'choose-project' || message.recovery === 'restart'
    ? message.recovery
    : 'retry';
  return {
    code,
    message: typeof message.message === 'string' && message.message.trim()
      ? message.message
      : 'The local terminal could not start.',
    recovery,
  };
}

export function useShellConnection({
  wsRef,
  terminalRef,
  fitAddonRef,
  selectedProjectRef,
  commandRef,
  onProcessCompleteRef,
  isInitialized,
  autoConnect,
  runtimeMode,
  closeSocket,
  clearTerminalScreen,
  onOutputRef,
}: UseShellConnectionOptions): UseShellConnectionResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<ShellConnectionError | null>(null);
  const connectingRef = useRef(false);
  const forceRestartOnInitRef = useRef(false);
  const suppressAutoConnectRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const activeModeRef = useRef<ShellTerminalMode>('interactive-terminal');

  const handleProcessCompletion = useCallback((output: string) => {
    if (!commandRef.current || !onProcessCompleteRef.current) return;
    const match = output.replace(ANSI_ESCAPE_REGEX, '').match(PROCESS_EXIT_REGEX);
    if (!match) return;
    const exitCode = Number.parseInt(match[1], 10);
    if (Number.isInteger(exitCode)) onProcessCompleteRef.current(exitCode);
  }, [commandRef, onProcessCompleteRef]);

  const handleSocketMessage = useCallback((rawPayload: string) => {
    const message = parseShellMessage(rawPayload);
    if (!message) {
      setConnectionError({
        code: 'SOCKET_FAILURE',
        message: 'The terminal returned an unreadable response.',
        recovery: 'retry',
      });
      return;
    }

    if (message.type === 'output') {
      handleProcessCompletion(message.data);
      terminalRef.current?.write(message.data);
      onOutputRef?.current?.();
      return;
    }

    if (message.type === 'ready') {
      setConnectionError(null);
      setIsConnected(true);
      setIsConnecting(false);
      connectingRef.current = false;
      return;
    }

    if (message.type === 'error') {
      setConnectionError(normalizeConnectionError(message));
      setIsConnected(false);
      setIsConnecting(false);
      connectingRef.current = false;
      return;
    }

    if (message.type === 'exit') {
      onProcessCompleteRef.current?.(message.exitCode);
      setIsConnected(false);
      setConnectionError({
        code: 'SHELL_UNAVAILABLE',
        message: `The terminal exited with code ${message.exitCode}.`,
        recovery: 'restart',
      });
      return;
    }

    if (
      message.type === 'auth_url'
      && activeModeRef.current === 'command-terminal'
      && message.autoOpen
      && message.url
    ) {
      window.open(message.url, '_blank', 'noopener,noreferrer');
    }
  }, [handleProcessCompletion, onOutputRef, onProcessCompleteRef, terminalRef]);

  const connectWebSocket = useCallback(async (connectionLockHeld = false) => {
    if ((connectingRef.current && !connectionLockHeld) || isConnecting || isConnected) return;

    const currentProject = selectedProjectRef.current;
    const command = commandRef.current?.trim() || '';
    const mode: ShellTerminalMode = command ? 'command-terminal' : 'interactive-terminal';
    activeModeRef.current = mode;
    if (!command && !currentProject?.projectId) {
      connectingRef.current = false;
      setIsConnecting(false);
      setConnectionError({
        code: 'PROJECT_MISSING',
        message: 'Choose a registered project before opening Shell.',
        recovery: 'choose-project',
      });
      return;
    }

    try {
      connectingRef.current = true;
      intentionalCloseRef.current = false;
      setConnectionError(null);

      if (runtimeMode === 'desktop-local') {
        const renewed = await renewDesktopLocalSession();
        if (renewed === false) {
          connectingRef.current = false;
          setIsConnecting(false);
          window.dispatchEvent(new Event(AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT));
          return;
        }
        if (!connectingRef.current) return;
      }

      const socket = new WebSocket(getShellWebSocketUrl(mode));
      wsRef.current = socket;

      socket.onopen = () => {
        const terminal = terminalRef.current;
        const fitAddon = fitAddonRef.current;
        const latestProject = selectedProjectRef.current;
        if (!terminal || !fitAddon) return;
        fitAddon.fit();

        if (mode === 'command-terminal') {
          sendSocketMessage(socket, createShellInitMessage({
            mode,
            command,
            cols: terminal.cols,
            rows: terminal.rows,
          }));
          return;
        }

        if (!latestProject?.projectId) {
          socket.close();
          return;
        }
        sendSocketMessage(socket, createShellInitMessage({
          mode,
          projectId: latestProject.projectId,
          cols: terminal.cols,
          rows: terminal.rows,
          forceRestart: forceRestartOnInitRef.current || undefined,
        }));
        forceRestartOnInitRef.current = false;
      };

      socket.onmessage = (event) => {
        handleSocketMessage(typeof event.data === 'string' ? event.data : String(event.data ?? ''));
      };

      socket.onclose = () => {
        const isCurrent = wsRef.current === socket;
        if (isCurrent) wsRef.current = null;
        setIsConnected(false);
        setIsConnecting(false);
        connectingRef.current = false;
        if (isCurrent && !intentionalCloseRef.current) {
          setConnectionError((current) => current ?? {
            code: 'SOCKET_FAILURE',
            message: 'The terminal connection closed unexpectedly.',
            recovery: 'retry',
          });
        }
      };

      socket.onerror = () => {
        setIsConnected(false);
        setIsConnecting(false);
        connectingRef.current = false;
        setConnectionError({
          code: 'SOCKET_FAILURE',
          message: 'The terminal socket could not connect.',
          recovery: 'retry',
        });
      };
    } catch {
      setIsConnected(false);
      setIsConnecting(false);
      connectingRef.current = false;
      setConnectionError({
        code: 'SOCKET_FAILURE',
        message: 'The terminal socket could not connect.',
        recovery: 'retry',
      });
    }
  }, [commandRef, fitAddonRef, handleSocketMessage, isConnected, isConnecting, runtimeMode, selectedProjectRef, terminalRef, wsRef]);

  const connectToShell = useCallback((options?: { forceRestart?: boolean }) => {
    if (!isInitialized || isConnected || isConnecting || connectingRef.current) return;
    forceRestartOnInitRef.current = Boolean(options?.forceRestart);
    suppressAutoConnectRef.current = false;
    connectingRef.current = true;
    setIsConnecting(true);
    void connectWebSocket(true);
  }, [connectWebSocket, isConnected, isConnecting, isInitialized]);

  const disconnectFromShell = useCallback((options?: { suppressAutoConnect?: boolean }) => {
    if (options?.suppressAutoConnect) suppressAutoConnectRef.current = true;
    intentionalCloseRef.current = true;
    closeSocket();
    clearTerminalScreen();
    setIsConnected(false);
    setIsConnecting(false);
    setConnectionError(null);
    connectingRef.current = false;
    forceRestartOnInitRef.current = false;
  }, [clearTerminalScreen, closeSocket]);

  useEffect(() => {
    if (
      !autoConnect
      || suppressAutoConnectRef.current
      || !isInitialized
      || isConnecting
      || isConnected
      || connectionError
    ) return;
    connectToShell();
  }, [autoConnect, connectToShell, connectionError, isConnected, isConnecting, isInitialized]);

  return {
    isConnected,
    isConnecting,
    connectionError,
    connectToShell,
    disconnectFromShell,
  };
}
