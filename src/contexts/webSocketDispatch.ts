export type WebSocketSendResult =
  | { ok: true }
  | { ok: false; reason: 'not-connected' | 'send-failed' };

type SendableWebSocket = {
  readyState: number;
  send(payload: string): void;
};

/**
 * Dispatches one JSON WebSocket frame without pretending a closed or failing
 * socket accepted it. Chat uses the result to keep drafts and processing state
 * untouched until the browser has synchronously accepted the frame.
 */
export function dispatchWebSocketMessage(
  socket: SendableWebSocket | null,
  openState: number,
  message: unknown,
): WebSocketSendResult {
  if (!socket || socket.readyState !== openState) {
    return { ok: false, reason: 'not-connected' };
  }

  try {
    socket.send(JSON.stringify(message));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'send-failed' };
  }
}

export type SendWebSocketMessage = (message: unknown) => WebSocketSendResult;
