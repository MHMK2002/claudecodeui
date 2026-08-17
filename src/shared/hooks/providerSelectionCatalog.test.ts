import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProviderSelectionCatalog } from '../../types/app';
import {
  readStoredProviderSelectionPreferences,
  decodeProviderSelectionCatalogResponse,
  getProviderCatalogSendBlockReason,
  getProviderCatalogRetryEmphasis,
  isDefaultProviderSelectionPendingCatalog,
  isChatSubmissionBlocked,
  markDefaultProviderSelectionPendingCatalog,
  clearDefaultProviderSelectionPendingCatalog,
  setDefaultProviderSelection,
} from '../providerSelectionCatalog';

import {
  resolveValidSelection,
  validateCatalogSelection,
} from './useProviderSelectionCatalog';

const catalog: ProviderSelectionCatalog = {
  providers: [
    {
      provider: 'claude',
      available: true,
      connectionAvailable: true,
      unavailableReason: null,
      profiles: [
        { id: 11, title: 'Work', isDefault: false },
        { id: 12, title: 'Default', isDefault: true },
      ],
      models: { OPTIONS: [{ value: 'sonnet', label: 'Sonnet' }], DEFAULT: 'sonnet' },
    },
    {
      provider: 'cursor',
      available: true,
      connectionAvailable: true,
      unavailableReason: null,
      profiles: [],
      models: { OPTIONS: [{ value: 'auto', label: 'Auto' }], DEFAULT: 'auto' },
    },
  ],
};

test('fresh profile selections remain marked until a current catalog validates them', () => {
  markDefaultProviderSelectionPendingCatalog('claude', 44);
  assert.equal(isDefaultProviderSelectionPendingCatalog('claude', 44), true);
  assert.equal(isDefaultProviderSelectionPendingCatalog('codex', 44), false);
  markDefaultProviderSelectionPendingCatalog('codex', 51);
  assert.equal(isDefaultProviderSelectionPendingCatalog('claude', 44), false);
  assert.equal(isDefaultProviderSelectionPendingCatalog('codex', 51), true);
  clearDefaultProviderSelectionPendingCatalog();
  assert.equal(isDefaultProviderSelectionPendingCatalog('claude', 44), false);
});

test('profile providers resolve their Settings default and permit a live CLI selection', () => {
  assert.deepEqual(resolveValidSelection(catalog, 'claude'), {
    provider: 'claude',
    providerProfileId: 12,
    model: 'sonnet',
  });
  assert.equal(validateCatalogSelection(catalog, {
    provider: 'claude',
    providerProfileId: null,
    model: 'sonnet',
  }), null);
  assert.deepEqual(resolveValidSelection(catalog, 'claude', { profileId: null }), {
    provider: 'claude',
    providerProfileId: null,
    model: 'sonnet',
  });
});

test('connection-backed providers keep a null profile and catalog model', () => {
  assert.deepEqual(resolveValidSelection(catalog, 'cursor'), {
    provider: 'cursor',
    providerProfileId: null,
    model: 'auto',
  });
  assert.equal(validateCatalogSelection(catalog, {
    provider: 'cursor',
    providerProfileId: null,
    model: 'auto',
  }), null);
});

test('invalid stored models fall back to the provider default', () => {
  assert.equal(resolveValidSelection(catalog, 'claude', {
    profileId: 11,
    model: 'removed-model',
  })?.model, 'sonnet');
});

test('one shared preference parser reads the complete provider/profile/model selection', () => {
  const values = new Map<string, string>([
    ['selected-provider', 'codex'],
    ['codex-provider-profile-id', '12'],
    ['codex-model', 'gpt-5.4'],
  ]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };

  assert.deepEqual(readStoredProviderSelectionPreferences(storage), {
    provider: 'codex',
    providerProfileId: 12,
    model: 'gpt-5.4',
  });

  values.set('selected-provider', 'opencode');
  values.set('opencode-model', 'anthropic/test');
  assert.deepEqual(readStoredProviderSelectionPreferences(storage), {
    provider: 'opencode',
    providerProfileId: null,
    model: 'anthropic/test',
  });
});

test('preference parser rejects invalid provider/profile/model storage without crossing providers', () => {
  const values = new Map<string, string>([
    ['selected-provider', 'unknown-provider'],
    ['claude-provider-profile-id', '-1'],
    ['claude-model', '   '],
    ['codex-provider-profile-id', '99'],
    ['codex-model', 'codex-only-model'],
  ]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };

  assert.deepEqual(readStoredProviderSelectionPreferences(storage), {
    provider: 'claude',
    providerProfileId: null,
    model: null,
  });
});

test('successful connection writes the new-chat provider/profile preference', () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem: (key: string, value: string) => values.set(key, value) },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: () => true },
  });
  try {
    setDefaultProviderSelection('claude', null);
    assert.equal(values.get('selected-provider'), 'claude');
    assert.equal(values.get('claude-provider-profile-id'), 'local');
    setDefaultProviderSelection('codex', 44);
    assert.equal(values.get('selected-provider'), 'codex');
    assert.equal(values.get('codex-provider-profile-id'), '44');
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('catalog decoder accepts application/problem+json and validates every nested field', async () => {
  const response = new Response(JSON.stringify({ success: true, data: catalog }), {
    status: 200,
    headers: { 'content-type': 'application/problem+json; charset=utf-8' },
  });

  assert.deepEqual(await decodeProviderSelectionCatalogResponse(response), catalog);
});

test('catalog decoder rejects HTML without attempting JSON parsing', async () => {
  const response = new Response('<!doctype html><title>Proxy error</title>', {
    status: 502,
    headers: { 'content-type': 'text/html' },
  });

  await assert.rejects(
    decodeProviderSelectionCatalogResponse(response),
    /Provider catalog request failed \(502\)\./,
  );
});

test('catalog decoder reports a stable schema error for malformed nested model effort', async () => {
  const malformed = structuredClone(catalog) as unknown as Record<string, unknown>;
  const providers = (malformed.providers as Array<Record<string, unknown>>);
  const models = providers[0]?.models as Record<string, unknown>;
  const options = models.OPTIONS as Array<Record<string, unknown>>;
  options[0] = {
    ...options[0],
    effort: { default: 'medium', values: [{ value: 3 }] },
  };
  const response = new Response(JSON.stringify({ success: true, data: malformed }), {
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    decodeProviderSelectionCatalogResponse(response),
    /Provider catalog response has an invalid schema\./,
  );
});

test('catalog decoder surfaces a typed JSON API error without leaking parser messages', async () => {
  const response = new Response(JSON.stringify({
    success: false,
    error: { code: 'CATALOG_UNAVAILABLE', message: 'Catalog service is unavailable.' },
  }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    decodeProviderSelectionCatalogResponse(response),
    /Catalog service is unavailable\./,
  );
});

test('catalog failure blocks idle Send but never blocks active Stop', () => {
  assert.equal(
    getProviderCatalogSendBlockReason('Provider catalog request failed (503).', false),
    'Providers are unavailable. Retry the catalog or open Agent Settings before sending.',
  );
  assert.equal(
    getProviderCatalogSendBlockReason('Provider catalog request failed (503).', true),
    null,
  );
  assert.equal(getProviderCatalogSendBlockReason(null, false), null);
  assert.equal(isChatSubmissionBlocked('Providers are unavailable.'), true);
  assert.equal(isChatSubmissionBlocked(null), false);
  assert.equal(getProviderCatalogRetryEmphasis('offline', false), 'primary');
  assert.equal(getProviderCatalogRetryEmphasis('offline', true), 'neutral');
});
