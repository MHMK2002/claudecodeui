import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '@/shared/types.js';
import { attachToolResultsToToolUseRows, sliceTailPage } from '@/shared/utils.js';

const base = {
  sessionId: 'session-1',
  provider: 'codex' as const,
  timestamp: '2026-08-16T00:00:00.000Z',
};

test('tool results are attached before totals and page boundaries are calculated', () => {
  const normalized: NormalizedMessage[] = [
    { ...base, id: 'user-1', kind: 'text', role: 'user', content: 'run it' },
    { ...base, id: 'tool-1', kind: 'tool_use', toolId: 'call-1', toolName: 'Bash' },
    { ...base, id: 'result-1', kind: 'tool_result', toolId: 'call-1', content: 'ok' },
    { ...base, id: 'assistant-1', kind: 'text', role: 'assistant', content: 'done' },
  ];

  const renderable = attachToolResultsToToolUseRows(normalized);
  assert.equal(renderable.length, 3);
  assert.deepEqual(renderable[1]?.toolResult, { content: 'ok', isError: false });

  const newest = sliceTailPage(renderable, 2, 0);
  assert.deepEqual(newest.page.map((message) => message.id), ['tool-1', 'assistant-1']);
  assert.equal(newest.hasMore, true);

  const oldest = sliceTailPage(renderable, 2, 2);
  assert.deepEqual(oldest.page.map((message) => message.id), ['user-1']);
  assert.equal(oldest.hasMore, false);
});
