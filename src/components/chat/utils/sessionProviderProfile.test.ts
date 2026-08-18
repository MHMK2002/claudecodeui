import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProjectSession } from '../../../types/app';

import { getSessionProviderProfileId } from './sessionProviderProfile';

test('reads profile metadata from project session summaries during same-provider switches', () => {
  const mainSession: ProjectSession = {
    id: 'session-main',
    provider: 'codex',
    providerProfileId: 11,
  };
  const personalSession: ProjectSession = {
    id: 'session-personal',
    provider: 'codex',
    providerProfileId: 22,
  };

  assert.equal(getSessionProviderProfileId(mainSession), 11);
  assert.equal(getSessionProviderProfileId(personalSession), 22);
});

test('prefers hydrated profile metadata and preserves an explicit local connection', () => {
  assert.equal(getSessionProviderProfileId({
    id: 'hydrated',
    providerProfileId: 11,
    __providerProfileId: 22,
  }), 22);
  assert.equal(getSessionProviderProfileId({
    id: 'local',
    providerProfileId: null,
  }), null);
  assert.equal(getSessionProviderProfileId({ id: 'legacy' }), undefined);
});
