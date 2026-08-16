import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyGitFailure } from '@/modules/git/git-error.service.js';

const failure = (message: string, code?: string) => Object.assign(new Error(message), { code });

test('Git failures map to stable recovery codes and actions', () => {
  const cases = [
    [failure('spawn git ENOENT', 'ENOENT'), 'status', 'GIT_MISSING', 'INSTALL_GIT'],
    [failure('Could not resolve hostname github.com'), 'fetch', 'NETWORK_OFFLINE', 'RETRY'],
    [failure('Permission denied (publickey)'), 'push', 'AUTH_FAILED', 'OPEN_GIT_SETTINGS'],
    [failure("fatal: 'origin' does not appear to be a git repository"), 'push', 'NO_REMOTE', 'OPEN_GIT_SETTINGS'],
    [failure('Your local changes would be overwritten by checkout'), 'checkout', 'DIRTY_BRANCH_SWITCH', 'REVIEW_CHANGES'],
    [failure('HEAD detached at abc123'), 'publish', 'DETACHED_HEAD', 'CREATE_BRANCH'],
    [failure('CONFLICT: content conflict'), 'pull', 'MERGE_CONFLICT', 'RESOLVE_CONFLICTS'],
    [failure('could not apply abc; resolve all conflicts manually'), 'continue', 'REBASE_CONFLICT', 'RESOLVE_CONFLICTS'],
    [failure('operation not permitted', 'EPERM'), 'write', 'PERMISSION_DENIED', 'RETRY'],
  ] as const;

  for (const [error, context, code, action] of cases) {
    const issue = classifyGitFailure(error, context);
    assert.equal(issue.code, code);
    assert.equal(issue.action, action);
    assert.equal(typeof issue.details, 'string');
  }
});
