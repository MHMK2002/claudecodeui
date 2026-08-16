import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDesktopOwnerProof,
  isDesktopShutdownAuthorized,
} from '../desktop-runtime.service.js';

test('desktop owner proof is stable without exposing the nonce', () => {
  const proof = getDesktopOwnerProof('private-owner-nonce');
  assert.match(proof ?? '', /^[a-f0-9]{64}$/);
  assert.notEqual(proof, 'private-owner-nonce');
  assert.equal(getDesktopOwnerProof(undefined), null);
});

test('desktop shutdown requires the exact owner nonce from loopback', () => {
  assert.equal(isDesktopShutdownAuthorized({
    remoteAddress: '127.0.0.1',
    providedOwnerNonce: 'owner-nonce',
    expectedOwnerNonce: 'owner-nonce',
  }), true);
  assert.equal(isDesktopShutdownAuthorized({
    remoteAddress: '192.0.2.10',
    providedOwnerNonce: 'owner-nonce',
    expectedOwnerNonce: 'owner-nonce',
  }), false);
  assert.equal(isDesktopShutdownAuthorized({
    remoteAddress: '::1',
    providedOwnerNonce: 'wrong',
    expectedOwnerNonce: 'owner-nonce',
  }), false);
});
