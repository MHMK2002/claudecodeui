import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCodexTaskMasterPolicy,
  getCodexPlanOptions,
  resolveCursorPermissionArgs,
} from '@/modules/taskmaster/taskmaster-provider-policy.js';

test('intake provider policies force read-only mode and disable Codex TaskMaster MCP', () => {
  assert.deepEqual(getCodexPlanOptions(), {
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
  });
  assert.deepEqual(resolveCursorPermissionArgs('plan'), ['--mode', 'plan']);
  assert.deepEqual(resolveCursorPermissionArgs('default'), []);

  const config = applyCodexTaskMasterPolicy({
    model: 'gpt-5',
    mcp_servers: {
      'task-master-ai': { enabled: true },
      docs: { enabled: true },
    },
  }, true);
  assert.deepEqual(config, {
    model: 'gpt-5',
    mcp_servers: {
      'task-master-ai': { enabled: false },
      docs: { enabled: true },
    },
  });
});
