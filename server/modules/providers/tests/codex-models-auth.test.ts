import assert from 'node:assert/strict';
import test from 'node:test';

import { readCodexCustomProviderCredentials } from '@/modules/providers/list/codex/codex-auth.provider.js';
import { buildCodexDefinitionFromAppServerModels } from '@/modules/providers/list/codex/codex-models.provider.js';

test('Codex models provider maps the app-server catalog used by the CLI', () => {
  const definition = buildCodexDefinitionFromAppServerModels([
    {
      id: 'gpt-5.6-sol',
      model: 'gpt-5.6-sol',
      displayName: 'GPT-5.6-Sol',
      description: 'Default proxy model',
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast' },
        { reasoningEffort: 'medium', description: 'Balanced' },
        { reasoningEffort: 'ultra', description: 'Deepest' },
      ],
    },
    {
      id: 'hidden-model',
      model: 'hidden-model',
      displayName: 'Hidden',
      hidden: true,
      isDefault: false,
      supportedReasoningEfforts: [],
    },
  ]);

  assert.equal(definition.DEFAULT, 'gpt-5.6-sol');
  assert.deepEqual(definition.OPTIONS, [
    {
      value: 'gpt-5.6-sol',
      label: 'GPT-5.6-Sol',
      description: 'Default proxy model',
      effort: {
        default: 'medium',
        values: [
          { value: 'low', description: 'Fast' },
          { value: 'medium', description: 'Balanced' },
          { value: 'ultra', description: 'Deepest' },
        ],
      },
    },
  ]);
});

test('Codex custom provider accepts credentials from its configured env_key', () => {
  const status = readCodexCustomProviderCredentials(
    {
      model_providers: {
        proxy: {
          name: 'Local Proxy',
          env_key: 'PROXY_API_KEY',
        },
      },
    },
    { PROXY_API_KEY: 'configured' },
  );

  assert.deepEqual(status, {
    authenticated: true,
    email: 'Local Proxy API Key',
    method: 'provider_api_key',
  });
});

test('Codex custom provider reports its missing env credential without requesting OpenAI login', () => {
  const status = readCodexCustomProviderCredentials(
    {
      model_providers: {
        proxy: {
          env_key: 'PROXY_API_KEY',
        },
      },
    },
    {},
  );

  assert.deepEqual(status, {
    authenticated: false,
    email: null,
    method: 'provider_api_key',
    error: 'PROXY_API_KEY is not set for Codex provider "proxy"',
  });
});

test('Codex providers backed by OpenAI auth retain the normal login flow', () => {
  const status = readCodexCustomProviderCredentials(
    {
      model_providers: {
        proxy: {
          requires_openai_auth: true,
        },
      },
    },
    {},
  );

  assert.equal(status, null);
});
