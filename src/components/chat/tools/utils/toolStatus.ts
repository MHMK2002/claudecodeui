import type { ToolStatus } from '../components/ToolStatusBadge';
import type { MessageTimestampValue } from '../../utils/messageTimestamp';

// Exact denial messages from the Claude runtime adapter — other providers
// cannot reliably signal denial, so their error events remain errors.
const CLAUDE_DENIAL_MESSAGES = [
  'user denied tool use',
  'tool disallowed by settings',
  'permission request timed out',
  'permission request cancelled',
];

export function deriveToolStatus(toolResult: unknown): ToolStatus {
  if (!toolResult) return 'running';

  const result = toolResult as { content?: unknown; isError?: boolean };
  if (result.isError) {
    const content = String(result.content || '').toLowerCase().trim();
    if (CLAUDE_DENIAL_MESSAGES.some((message) => content.includes(message))) {
      return 'denied';
    }
    return 'error';
  }

  return 'completed';
}

type ToolGroupStatusSource = {
  toolResult?: unknown;
  timestamp?: MessageTimestampValue;
};

export function deriveToolGroupExecution(messages: readonly ToolGroupStatusSource[]): {
  status: ToolStatus;
  timestamp?: MessageTimestampValue;
} {
  const evaluated = messages.map((message) => ({
    status: deriveToolStatus(message.toolResult),
    timestamp: message.timestamp,
  }));

  for (const priority of ['running', 'error', 'denied'] as const) {
    for (let index = evaluated.length - 1; index >= 0; index -= 1) {
      if (evaluated[index]?.status === priority) {
        return evaluated[index];
      }
    }
  }

  return evaluated[evaluated.length - 1] ?? { status: 'completed' };
}
