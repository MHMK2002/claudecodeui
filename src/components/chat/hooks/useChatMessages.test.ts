import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';

import { normalizedToChatMessages } from './useChatMessages';

const codexToolMessage = (
  overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage => ({
  id: 'tool-1',
  sessionId: 'session-1',
  timestamp: '2026-08-17T09:00:00.000Z',
  provider: 'codex',
  kind: 'tool_use',
  toolName: 'Bash',
  toolInput: { command: 'true' },
  toolId: 'tool-1',
  ...overrides,
});

test('Codex terminal tool status becomes a completed tool result without a separate result event', () => {
  const [message] = normalizedToChatMessages([
    codexToolMessage({ status: 'completed', exitCode: 0 }),
  ]);

  assert.deepEqual(message?.toolResult, {
    content: '',
    isError: false,
    toolUseResult: undefined,
  });
});

test('Codex failed tool status becomes an error while an in-progress tool remains running', () => {
  const [failed, running] = normalizedToChatMessages([
    codexToolMessage({ id: 'failed', toolId: 'failed', status: 'failed', exitCode: 1 }),
    codexToolMessage({ id: 'running', toolId: 'running', status: 'in_progress' }),
  ]);

  assert.equal(failed?.toolResult?.isError, true);
  assert.equal(running?.toolResult, null);
});
