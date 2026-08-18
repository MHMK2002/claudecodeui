import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialProviderAuthStatusMap } from '../../../../provider-auth/types';
import { resolveInitialAgentSelection } from './agentSelection';

const settledStatuses = () => createInitialProviderAuthStatusMap(false);

test('selects Codex when it is the sole authenticated Agent', () => {
  const statuses = settledStatuses();
  statuses.codex.authenticated = true;

  assert.equal(resolveInitialAgentSelection(statuses, 'claude', false), 'codex');
});

test('waits for every authentication status and preserves a manual selection', () => {
  const statuses = settledStatuses();
  statuses.codex.authenticated = true;
  statuses.claude.loading = true;

  assert.equal(resolveInitialAgentSelection(statuses, 'claude', false), 'claude');
  statuses.claude.loading = false;
  assert.equal(resolveInitialAgentSelection(statuses, 'claude', true), 'claude');
});

test('keeps Claude when zero or multiple Agents are authenticated', () => {
  const none = settledStatuses();
  assert.equal(resolveInitialAgentSelection(none, 'claude', false), 'claude');

  const multiple = settledStatuses();
  multiple.claude.authenticated = true;
  multiple.codex.authenticated = true;
  assert.equal(resolveInitialAgentSelection(multiple, 'claude', false), 'claude');
});
