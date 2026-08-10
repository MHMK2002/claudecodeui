/**
 * WebSocket broadcast helpers for scheduled agent runs.
 *
 * Follows the `connectedClients` fan-out pattern from `chat-run-registry.service.ts`
 * (also used by `sessions-watcher.service.ts`). The envelope shape uses
 * `kind` (not `type`) to match the unified chat-event protocol the rest of
 * the websocket layer emits.
 */

import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';

function send(body) {
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      try {
        client.send(body);
      } catch (error) {
        console.error('[ScheduledRuns] broadcast send error:', error);
      }
    }
  });
}

/**
 * Signal that the schedule list (or any schedule row) changed and the
 * frontend should refetch. Carries the affected userId so the frontend
 * could filter in the future if per-user broadcasts become necessary.
 */
export function broadcastScheduledRunsChanged(userId) {
  const body = JSON.stringify({
    kind: 'scheduled_runs.changed',
    userId,
    timestamp: new Date().toISOString(),
  });
  send(body);
}

/**
 * Signal that a single run finished. Used by the UI to refresh the
 * schedule's status pill and history panel without a full refetch.
 */
export function broadcastScheduledRunFinished(userId, payload) {
  const body = JSON.stringify({
    kind: 'scheduled_run.finished',
    userId,
    timestamp: new Date().toISOString(),
    ...payload,
  });
  send(body);
}