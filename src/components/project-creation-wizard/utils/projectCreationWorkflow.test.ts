import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCloneDestination,
  getProjectConfigurationFields,
  getProjectErrorPresentation,
  getProjectErrorRecoveryStep,
  shouldResetCredentialChallenge,
} from './projectCreationWorkflow.js';

test('local configuration exposes only the existing-folder picker', () => {
  assert.deepEqual(getProjectConfigurationFields('local', false), ['folder']);
});

test('clone configuration discloses credentials only after auth is required', () => {
  assert.deepEqual(getProjectConfigurationFields('clone', false), [
    'repositoryUrl',
    'destination',
  ]);
  assert.deepEqual(getProjectConfigurationFields('clone', true), [
    'repositoryUrl',
    'destination',
    'credential',
  ]);
});

test('review computes the exact destination for common HTTPS and SSH repositories', () => {
  assert.equal(
    buildCloneDestination('/workspace', 'https://gitlab.com/example/project.git'),
    '/workspace/project',
  );
  assert.equal(
    buildCloneDestination('C:\\workspace', 'git@github.com:example/project.git'),
    'C:\\workspace\\project',
  );
});

test('every required project error has contextual recovery and focus', () => {
  const expected = {
    INVALID_PROJECT_PATH: ['BROWSE', 'folder'],
    PROJECT_PATH_NOT_WRITABLE: ['CHOOSE_ANOTHER', 'folder'],
    CLONE_DESTINATION_NOT_EMPTY: ['CHOOSE_ANOTHER', 'destination'],
    PROJECT_ALREADY_EXISTS: ['CHOOSE_ANOTHER', 'folder'],
    GIT_NOT_FOUND: ['INSTALL_GIT', 'repositoryUrl'],
    INVALID_REPOSITORY_URL: ['CHANGE_REPOSITORY', 'repositoryUrl'],
    AUTH_REQUIRED: ['CHANGE_CREDENTIAL', 'credential'],
    REPOSITORY_NOT_FOUND: ['CHANGE_REPOSITORY', 'repositoryUrl'],
    NETWORK_OFFLINE: ['RETRY', 'repositoryUrl'],
    CLONE_CONFLICT: ['CHOOSE_ANOTHER', 'destination'],
    OPERATION_CANCELLED: ['RETRY', 'repositoryUrl'],
  } as const;

  for (const [code, [action, field]] of Object.entries(expected)) {
    const presentation = getProjectErrorPresentation(code);
    assert.equal(presentation.action, action, code);
    assert.equal(presentation.field, field, code);
    assert.ok(presentation.message.length > 0, code);
  }
});

test('insecure URLs and URLs containing credentials are not accepted for review', () => {
  assert.equal(buildCloneDestination('/workspace', 'http://github.com/example/repo.git'), '');
  assert.equal(buildCloneDestination('/workspace', 'https://user@github.com/example/repo.git'), '');
  assert.equal(buildCloneDestination('/workspace', 'https://user:secret@github.com/example/repo.git'), '');
  assert.equal(buildCloneDestination('/workspace', 'ssh://git:secret@github.com/example/repo.git'), '');
  assert.equal(
    buildCloneDestination('/workspace', 'ssh://git@github.com/example/repo.git'),
    '/workspace/repo',
  );
});

test('changing the challenged repository clears its credential state', () => {
  assert.equal(shouldResetCredentialChallenge(
    'https://github.com/example/private.git',
    'https://gitlab.com/example/private.git',
  ), true);
  assert.equal(shouldResetCredentialChallenge(
    'https://github.com/example/private.git',
    'https://github.com/example/private.git',
  ), false);
});

test('retry recovery stays on review while field recovery returns to configuration', () => {
  assert.equal(getProjectErrorRecoveryStep('RETRY'), 3);
  assert.equal(getProjectErrorRecoveryStep('CHANGE_REPOSITORY'), 2);
  assert.equal(getProjectErrorRecoveryStep('CHOOSE_ANOTHER'), 2);
});

test('all backend clone errors have an explicit frontend presentation', () => {
  for (const code of [
    'INVALID_CLONE_ATTEMPT_ID',
    'AUTHENTICATION_REQUIRED',
    'CLONE_ATTEMPT_CONFLICT',
    'INVALID_PROJECT_PATH',
    'INVALID_REPOSITORY_URL',
    'CLONE_DESTINATION_NOT_EMPTY',
    'PROJECT_PATH_NOT_WRITABLE',
    'PROJECT_ALREADY_EXISTS',
    'CREDENTIAL_HOST_MISMATCH',
    'AUTH_REQUIRED',
    'CREDENTIAL_UNSUPPORTED_FOR_SSH',
    'OPERATION_CANCELLED',
    'GIT_NOT_FOUND',
    'GIT_EXECUTION_FAILED',
    'REPOSITORY_NOT_FOUND',
    'NETWORK_OFFLINE',
    'CLONE_CONFLICT',
    'GIT_CLONE_FAILED',
    'CLONE_PROJECT_REGISTRATION_FAILED',
    'CLONE_CLEANUP_REQUIRED',
    'CLONE_STAGING_OWNERSHIP_LOST',
    'CLONE_ROLLBACK_OWNERSHIP_LOST',
    'CLONE_REPAIR_REQUIRED',
  ]) {
    const presentation = getProjectErrorPresentation(code);
    assert.notEqual(presentation.code, 'UNKNOWN', code);
  }

  const repairPresentation = getProjectErrorPresentation('CLONE_REPAIR_REQUIRED');
  assert.equal(repairPresentation.action, 'OPEN_EXISTING');
  assert.equal(repairPresentation.field, 'destination');
});

test('prototype property names and non-string messages use safe error presentation fallback', () => {
  const prototypeCode = getProjectErrorPresentation('toString', 'Malformed server response');
  assert.equal(prototypeCode.code, 'UNKNOWN');
  assert.equal(prototypeCode.action, 'RETRY');
  assert.equal(prototypeCode.field, 'folder');

  const objectMessage = getProjectErrorPresentation('NETWORK_OFFLINE', { unsafe: true });
  assert.equal(objectMessage.code, 'NETWORK_OFFLINE');
  assert.equal(objectMessage.message, 'The Git host is unreachable. Check your connection and retry.');
});
