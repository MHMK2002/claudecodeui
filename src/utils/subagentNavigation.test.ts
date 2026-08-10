import assert from 'node:assert/strict';
import test from 'node:test';

import type { SubagentTranscript } from '../types/app';

import {
  buildSubagentRoute,
  resolveSubagentTranscript,
} from './subagentNavigation';

const agents: SubagentTranscript[] = [
  {
    sessionId: 'agent-1',
    provider: 'codex',
    parentSessionId: 'parent-1',
    name: 'Noether',
    agentType: 'dispatch',
    status: 'completed',
    toolCount: 0,
    currentTool: null,
    totalTokens: null,
    totalDurationMs: null,
    createdAt: null,
    updatedAt: null,
  },
];

test('subagent routes are scoped by both parent and child identity', () => {
  assert.equal(
    buildSubagentRoute('parent/with spaces', 'agent?1'),
    '/session/parent%2Fwith%20spaces/subagent/agent%3F1',
  );
});

test('subagent resolution validates parent-child membership', () => {
  assert.equal(resolveSubagentTranscript('parent-1', 'agent-1', agents), agents[0]);
  assert.equal(resolveSubagentTranscript('another-parent', 'agent-1', agents), null);
  assert.equal(resolveSubagentTranscript('parent-1', 'missing-agent', agents), null);
});
