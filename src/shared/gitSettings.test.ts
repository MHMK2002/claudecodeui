import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeGitSettingsResponse,
  lowestCommitMessageEffort,
  validateCommitMessageGeneratorSettings,
} from './gitSettings.js';

const catalog = {
  providers: [{
    provider: 'codex' as const,
    available: true,
    connectionAvailable: false,
    unavailableReason: null,
    profiles: [{ id: 3, title: 'Work', isDefault: true }],
    models: {
      DEFAULT: 'gpt-test',
      OPTIONS: [{
        value: 'gpt-test',
        label: 'GPT Test',
        effort: { default: 'high', values: [{ value: 'low' }, { value: 'high' }] },
      }],
    },
  }],
};

test('Git settings decoder accepts a global generator response and rejects malformed effort', async () => {
  const response = new Response(JSON.stringify({
    success: true,
    gitName: 'Alice',
    gitEmail: 'alice@example.com',
    commitMessage: {
      provider: 'codex',
      providerProfileId: 3,
      model: 'gpt-test',
      effort: 'low',
      basePrompt: 'Be concise.',
    },
    defaultCommitMessageBasePrompt: 'Default prompt',
    commitMessageBasePromptMaxLength: 800,
  }), { headers: { 'content-type': 'application/json' } });
  assert.equal((await decodeGitSettingsResponse(response)).commitMessage?.effort, 'low');

  const malformed = new Response(JSON.stringify({
    success: true,
    gitName: null,
    gitEmail: null,
    commitMessage: {
      provider: 'codex', providerProfileId: 3, model: 'gpt-test', effort: 3, basePrompt: '',
    },
    defaultCommitMessageBasePrompt: 'Default prompt',
    commitMessageBasePromptMaxLength: 800,
  }), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(decodeGitSettingsResponse(malformed), /invalid schema/i);
});

test('Generator defaults to low effort and validates prompt and model effort', () => {
  const model = catalog.providers[0].models.OPTIONS[0];
  assert.equal(lowestCommitMessageEffort(model), 'low');
  assert.equal(validateCommitMessageGeneratorSettings(catalog, {
    provider: 'codex',
    providerProfileId: 3,
    model: 'gpt-test',
    effort: 'low',
    basePrompt: 'Be concise.',
  }, 800), null);
  assert.match(validateCommitMessageGeneratorSettings(catalog, {
    provider: 'codex',
    providerProfileId: 3,
    model: 'gpt-test',
    effort: 'max',
    basePrompt: 'Be concise.',
  }, 800) ?? '', /effort/i);
});
