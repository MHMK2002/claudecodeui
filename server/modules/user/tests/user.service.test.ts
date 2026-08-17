import assert from 'node:assert/strict';
import test from 'node:test';

import type { CommitMessageGeneratorSettings } from '@/shared/types.js';
import {
  COMMIT_MESSAGE_BASE_PROMPT_MAX_LENGTH,
  DEFAULT_COMMIT_MESSAGE_BASE_PROMPT,
} from '@/shared/utils.js';

import { createUserService } from '../user.service.js';

type UserDependencies = Parameters<typeof createUserService>[0];

function createDependencies(overrides: Partial<UserDependencies> = {}): UserDependencies {
  return {
    users: {
      getGitConfig: () => undefined,
      updateGitIdentity: () => undefined,
      getCommitMessageGeneratorSettings: () => null,
      updateGitConfig: () => undefined,
      completeOnboarding: () => undefined,
      hasCompletedOnboarding: () => false,
    },
    resolveDefaultTextCompletionSelection: async () => ({
      provider: 'codex',
      providerProfileId: 4,
      model: 'gpt-test',
      effort: 'low',
    }),
    validateProviderSelection: async () => undefined,
    readSystemGitConfig: async () => ({ git_name: null, git_email: null }),
    applyGlobalGitConfig: async () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
    ...overrides,
  };
}

test('getGitConfig imports system configuration when the repository is empty', async () => {
  const updates: unknown[][] = [];
  const service = createUserService(createDependencies({
    users: {
      getGitConfig: () => undefined,
      updateGitIdentity: (...args) => updates.push(args),
      getCommitMessageGeneratorSettings: () => null,
      updateGitConfig: () => undefined,
      completeOnboarding: () => undefined,
      hasCompletedOnboarding: () => false,
    },
    readSystemGitConfig: async () => ({ git_name: 'Alice', git_email: 'alice@example.com' }),
  }));

  const result = await service.getGitConfig(7);

  assert.equal(result.gitName, 'Alice');
  assert.deepEqual(result.commitMessage, {
    provider: 'codex',
    providerProfileId: 4,
    model: 'gpt-test',
    effort: 'low',
    basePrompt: DEFAULT_COMMIT_MESSAGE_BASE_PROMPT,
  });
  assert.deepEqual(updates, [[7, 'Alice', 'alice@example.com']]);
});

test('updateGitConfig validates and atomically persists identity plus global generator settings', async () => {
  const operations: string[] = [];
  let savedSettings: CommitMessageGeneratorSettings | null = null;
  const service = createUserService(createDependencies({
    users: {
      getGitConfig: () => undefined,
      updateGitIdentity: () => undefined,
      getCommitMessageGeneratorSettings: () => savedSettings,
      updateGitConfig: (_id, name, email, generator) => {
        savedSettings = generator;
        operations.push(`persist:${name}:${email}:${generator.provider}:${generator.effort}`);
      },
      completeOnboarding: () => undefined,
      hasCompletedOnboarding: () => false,
    },
    validateProviderSelection: async (selection) => {
      operations.push(`validate:${selection.provider}:${selection.model}:${selection.effort}`);
    },
    applyGlobalGitConfig: async (name, email) => {
      operations.push(`git:${name}:${email}`);
    },
  }));

  const result = await service.updateGitConfig(1, {
    gitName: 'Alice',
    gitEmail: 'alice@example.com',
    commitMessage: {
      provider: 'claude',
      providerProfileId: 9,
      model: 'sonnet',
      effort: 'low',
      basePrompt: 'Use concise Persian subjects.',
    },
  });
  assert.deepEqual(operations, [
    'validate:claude:sonnet:low',
    'persist:Alice:alice@example.com:claude:low',
    'git:Alice:alice@example.com',
  ]);
  assert.equal(result.commitMessage?.basePrompt, 'Use concise Persian subjects.');
});

test('updateGitConfig rejects an oversized base prompt before validation or persistence', async () => {
  let validated = false;
  let persisted = false;
  const service = createUserService(createDependencies({
    users: {
      getGitConfig: () => undefined,
      updateGitIdentity: () => undefined,
      getCommitMessageGeneratorSettings: () => null,
      updateGitConfig: () => { persisted = true; },
      completeOnboarding: () => undefined,
      hasCompletedOnboarding: () => false,
    },
    validateProviderSelection: async () => { validated = true; },
  }));

  await assert.rejects(
    service.updateGitConfig(1, {
      gitName: 'Alice',
      gitEmail: 'alice@example.com',
      commitMessage: {
        provider: 'codex',
        providerProfileId: 4,
        model: 'gpt-test',
        effort: 'low',
        basePrompt: 'x'.repeat(COMMIT_MESSAGE_BASE_PROMPT_MAX_LENGTH + 1),
      },
    }),
    /generator settings are invalid/i,
  );
  assert.equal(validated, false);
  assert.equal(persisted, false);
});
