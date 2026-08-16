import { useCallback, useEffect, useRef } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

import type { UseShellRuntimeOptions, UseShellRuntimeResult } from '../types/types';
import { useAuth } from '../../auth/context/AuthContext';

import { useShellConnection } from './useShellConnection';
import { useShellTerminal } from './useShellTerminal';

export function useShellRuntime({
  selectedProject,
  command,
  minimal,
  autoConnect,
  isRestarting,
  onProcessComplete,
  onOutputRef,
}: UseShellRuntimeOptions): UseShellRuntimeResult {
  const { runtimeMode } = useAuth();
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const selectedProjectRef = useRef(selectedProject);
  const commandRef = useRef(command);
  const onProcessCompleteRef = useRef(onProcessComplete);
  const lastTerminalKeyRef = useRef(`${selectedProject?.projectId ?? ''}:${command ?? ''}`);

  // Keep mutable values in refs so websocket handlers always read current data.
  useEffect(() => {
    selectedProjectRef.current = selectedProject;
    commandRef.current = command;
    onProcessCompleteRef.current = onProcessComplete;
  }, [command, onProcessComplete, selectedProject]);

  const closeSocket = useCallback(() => {
    const activeSocket = wsRef.current;
    if (!activeSocket) {
      return;
    }

    if (
      activeSocket.readyState === WebSocket.OPEN ||
      activeSocket.readyState === WebSocket.CONNECTING
    ) {
      activeSocket.close();
    }

    wsRef.current = null;
  }, []);

  const { isInitialized, clearTerminalScreen, disposeTerminal } = useShellTerminal({
    terminalContainerRef,
    terminalRef,
    fitAddonRef,
    wsRef,
    selectedProject,
    minimal,
    isRestarting,
    closeSocket,
  });

  const {
    isConnected,
    isConnecting,
    connectionError,
    connectToShell,
    disconnectFromShell,
  } = useShellConnection({
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
  });

  useEffect(() => {
    if (!isRestarting) {
      return;
    }

    disconnectFromShell({ suppressAutoConnect: true });
    disposeTerminal();
  }, [disconnectFromShell, disposeTerminal, isRestarting]);

  useEffect(() => {
    if (selectedProject) {
      return;
    }

    disconnectFromShell();
    disposeTerminal();
  }, [disconnectFromShell, disposeTerminal, selectedProject]);

  useEffect(() => {
    const currentTerminalKey = `${selectedProject?.projectId ?? ''}:${command ?? ''}`;
    if (lastTerminalKeyRef.current !== currentTerminalKey && isInitialized) {
      disconnectFromShell();
    }

    lastTerminalKeyRef.current = currentTerminalKey;
  }, [command, disconnectFromShell, isInitialized, selectedProject?.projectId]);

  return {
    terminalContainerRef,
    terminalRef,
    wsRef,
    isConnected,
    isInitialized,
    isConnecting,
    connectionError,
    connectToShell,
    disconnectFromShell,
  };
}
