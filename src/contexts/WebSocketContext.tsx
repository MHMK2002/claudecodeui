import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../components/auth/context/AuthContext';
import { IS_PLATFORM } from '../constants/config';
import {
  AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT,
  renewDesktopLocalSession,
} from '../utils/api';
import {
  dispatchWebSocketMessage,
  type SendWebSocketMessage,
} from './webSocketDispatch';

/**
 * One frame received from the chat websocket. The server guarantees every
 * frame carries a `kind` (provider message kinds plus gateway kinds such as
 * `chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`). The synthetic `websocket_reconnected` kind is injected
 * client-side when the socket re-opens after a drop.
 */
export type ServerEvent = {
  kind?: string;
  type?: string;
  sessionId?: string;
  seq?: number;
  [key: string]: unknown;
};

type ServerEventListener = (event: ServerEvent) => void;

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: SendWebSocketMessage;
  /** Immediately replaces the current/failed socket instead of waiting for the backoff. */
  reconnect: () => void;
  /**
   * Subscribes to every websocket frame. Returns an unsubscribe function.
   *
   * This is the primary consumption API: events are dispatched synchronously
   * to every listener, so rapid back-to-back frames can never be coalesced or
   * dropped the way a single "latest message" state slot could.
   */
  subscribe: (listener: ServerEventListener) => () => void;
  /**
   * Legacy state-based access to the most recent frame.
   *
   * Kept only for low-frequency consumers (TaskMaster broadcasts). High-rate
   * chat streams must use `subscribe` — React may batch state updates, which
   * makes `latestMessage` lossy under load.
   */
  latestMessage: ServerEvent | null;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false); // Track if component is unmounted
  const connectionGenerationRef = useRef(0);
  const hasConnectedRef = useRef(false); // Track if we've ever connected (to detect reconnects)
  /**
   * Listener registry for the subscribe API. A ref (not state) because the
   * set must be readable synchronously inside `onmessage` and never trigger
   * re-renders of the provider tree.
   */
  const listenersRef = useRef(new Set<ServerEventListener>());
  const [latestMessage, setLatestMessage] = useState<ServerEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { isLoading: isAuthLoading, runtimeMode, user } = useAuth();

  const dispatch = useCallback((event: ServerEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    }
    setLatestMessage(event);
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return; // Prevent connection if unmounted
    if (!IS_PLATFORM && (isAuthLoading || !user)) return;
    const connectionGeneration = ++connectionGenerationRef.current;
    const openConnection = async () => {
      let renewed: boolean | null = null;
      if (runtimeMode === 'desktop-local') {
        renewed = await renewDesktopLocalSession();
      }
      if (
        unmountedRef.current
        || connectionGenerationRef.current !== connectionGeneration
      ) {
        return;
      }
      if (renewed === false) {
        window.dispatchEvent(new Event(AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT));
        return;
      }

      try {
        const wsUrl = buildWebSocketUrl();

        const websocket = new WebSocket(wsUrl);
        wsRef.current = websocket;

        websocket.onopen = () => {
          setIsConnected(true);
          if (hasConnectedRef.current) {
            dispatch({ kind: 'websocket_reconnected', timestamp: Date.now() });
          }
          hasConnectedRef.current = true;
        };

        websocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as ServerEvent;
            dispatch(data);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        websocket.onclose = () => {
          if (wsRef.current !== websocket) return;
          setIsConnected(false);
          wsRef.current = null;

          reconnectTimeoutRef.current = setTimeout(() => {
            if (unmountedRef.current) return;
            connect();
          }, 3000);
        };

        websocket.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
      } catch (error) {
        console.error('Error creating WebSocket connection:', error);
      }
    };

    void openConnection();
  }, [dispatch, isAuthLoading, runtimeMode, user]);

  useEffect(() => {
    unmountedRef.current = false;
    if (!IS_PLATFORM && (isAuthLoading || !user)) {
      return undefined;
    }
    connect();

    return () => {
      connectionGenerationRef.current += 1;
      unmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      const activeSocket = wsRef.current;
      if (activeSocket) {
        activeSocket.onopen = null;
        activeSocket.onmessage = null;
        activeSocket.onclose = null;
        activeSocket.onerror = null;
        activeSocket.close();
        wsRef.current = null;
      }
    };
  }, [connect, isAuthLoading, user]);

  const sendMessage = useCallback<SendWebSocketMessage>((message) => {
    const result = dispatchWebSocketMessage(wsRef.current, WebSocket.OPEN, message);
    if (!result.ok) {
      console.warn('WebSocket message was not accepted:', result.reason);
    }
    return result;
  }, []);

  const reconnect = useCallback(() => {
    if (unmountedRef.current || (!IS_PLATFORM && (isAuthLoading || !user))) {
      return;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    const socket = wsRef.current;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      wsRef.current = null;
      socket.close();
    }
    setIsConnected(false);
    connect();
  }, [connect, isAuthLoading, user]);

  const subscribe = useCallback((listener: ServerEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    reconnect,
    subscribe,
    latestMessage,
    isConnected
  }), [sendMessage, reconnect, subscribe, latestMessage, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
