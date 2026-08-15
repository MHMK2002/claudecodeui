import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProviderSelectionCatalog } from '../../types/app';
import {
  resolveValidSelection,
  validateCatalogSelection,
} from './useProviderSelectionCatalog';

const catalog: ProviderSelectionCatalog = {
  providers: [
    {
      provider: 'claude',
      available: true,
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
      unavailableReason: null,
      profiles: [],
      models: { OPTIONS: [{ value: 'auto', label: 'Auto' }], DEFAULT: 'auto' },
    },
  ],
};

test('profile providers resolve their Settings default and never a Local CLI selection', () => {
  assert.deepEqual(resolveValidSelection(catalog, 'claude'), {
    provider: 'claude',
    providerProfileId: 12,
    model: 'sonnet',
  });
  assert.match(
    validateCatalogSelection(catalog, {
      provider: 'claude',
      providerProfileId: null,
      model: 'sonnet',
    }) ?? '',
    /profile/i,
  );
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
