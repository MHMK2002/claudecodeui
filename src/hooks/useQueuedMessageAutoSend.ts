import { useEffect, useRef } from 'react';

import { clearQueuedMessage, readQueuedMessage } from '../components/chat/utils/chatStorage';

import type { MarkSessionProcessing, SessionActivityMap } from './useSessionProtection';
import type { SendWebSocketMessage } from '../contexts/webSocketDispatch';

interface UseQueuedMessageAutoSendArgs {
  processingSessions: SessionActivityMap;
  /**
   * The session currently open in the chat view. Its queued draft is owned by
   * the composer (which also handles file attachments and slash commands),
   * so this hook never touches it.
   */
  activeSessionId: string | null;
  ws: WebSocket | null;
  sendMessage: SendWebSocketMessage;
  markSessionProcessing: MarkSessionProcessing;
}

/**
 * Combines newly completed background runs with deliveries retained from an
 * earlier closed/failed socket. Active or running sessions keep their current
 * owner and are reconsidered on a later effect instead of being dispatched.
 */
export function collectQueuedAutoSendCandidates(
  previousProcessing: ReadonlySet<string>,
  currentProcessing: ReadonlySet<string>,
  pendingDelivery: ReadonlySet<string>,
  activeSessionId: string | null,
): Set<string> {
  const candidates = new Set(pendingDelivery);
  for (const sessionId of previousProcessing) {
    if (!currentProcessing.has(sessionId)) candidates.add(sessionId);
  }
  for (const sessionId of candidates) {
    if (currentProcessing.has(sessionId) || sessionId === activeSessionId) {
      candidates.delete(sessionId);
    }
  }
  return candidates;
}

/**
 * Dispatches queued messages for sessions the user is NOT currently viewing.
 *
 * The composer persists each queued draft (text + send options snapshotted at
 * queue time) under `queued_message_<sessionId>`. When a session's run leaves
 * the processing map — its previous response completed — this hook sends that
 * session's queued message immediately instead of waiting for the user to
 * open the session again. The storage key is removed only after the socket
 * accepts the frame; that accepted delivery is the claim that keeps the
 * composer's own flush from double-sending.
 */
export function useQueuedMessageAutoSend({
  processingSessions,
  activeSessionId,
  ws,
  sendMessage,
  markSessionProcessing,
}: UseQueuedMessageAutoSendArgs) {
  const prevProcessingRef = useRef<ReadonlySet<string>>(new Set());
  const pendingDeliveryRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevProcessingRef.current;
    const current = new Set(processingSessions.keys());
    prevProcessingRef.current = current;
    const candidates = collectQueuedAutoSendCandidates(
      prev,
      current,
      pendingDeliveryRef.current,
      activeSessionId,
    );

    for (const sessionId of candidates) {
      const queued = readQueuedMessage(sessionId);
      if (!queued) {
        pendingDeliveryRef.current.delete(sessionId);
        continue;
      }

      // Keep an explicit retry owner. The completed session is no longer in
      // either processing set, so relying on a future transition would strand
      // this persisted draft after reconnect.
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        pendingDeliveryRef.current.add(sessionId);
        continue;
      }

      const dispatched = sendMessage({
        type: 'chat.send',
        sessionId,
        content: queued.content,
        options: { ...(queued.options ?? {}), attachments: queued.attachments ?? queued.images ?? [] },
      });
      if (!dispatched.ok) {
        pendingDeliveryRef.current.add(sessionId);
        continue;
      }
      pendingDeliveryRef.current.delete(sessionId);
      clearQueuedMessage(sessionId);
      markSessionProcessing(sessionId, { statusText: null, canInterrupt: true });
    }
  }, [processingSessions, activeSessionId, ws, sendMessage, markSessionProcessing]);
}
