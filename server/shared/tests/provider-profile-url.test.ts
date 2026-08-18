import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProviderTokenVerificationUrl,
  normalizeProviderBaseUrl,
} from '@/shared/utils.js';

test('normalizes provider Base URLs without dropping gateway path prefixes', () => {
  assert.equal(
    normalizeProviderBaseUrl('  https://gateway.example/proxy/v1/  '),
    'https://gateway.example/proxy/v1',
  );
  assert.equal(
    buildProviderTokenVerificationUrl('codex', 'https://gateway.example/proxy/v1/'),
    'https://gateway.example/proxy/v1/models',
  );
  assert.equal(
    buildProviderTokenVerificationUrl('claude', 'https://gateway.example/proxy/v1/'),
    'https://gateway.example/proxy/v1/models?limit=1',
  );
});

test('uses provider defaults when Base URL is empty and rejects unsupported schemes', () => {
  assert.equal(
    buildProviderTokenVerificationUrl('codex', null),
    'https://api.openai.com/v1/models',
  );
  assert.equal(
    buildProviderTokenVerificationUrl('claude', null),
    'https://api.anthropic.com/v1/models?limit=1',
  );
  assert.throws(
    () => normalizeProviderBaseUrl('ftp://gateway.example/v1'),
    (error: unknown) => (error as { code?: string }).code === 'INVALID_PROVIDER_PROFILE_BASE_URL',
  );
});
