import assert from 'node:assert/strict';
import test from 'node:test';

import { api } from '../../../utils/api.js';

import {
  cancelCloneAttempt,
  cloneWorkspaceWithProgress,
  createProjectRequest,
  ProjectCreationRequestError,
} from './workspaceApi.js';

test('clone progress sends an attempt-scoped request and parses structured progress', async (t) => {
  const originalPost = api.post;
  t.after(() => { api.post = originalPost; });
  let capturedEndpoint = '';
  let capturedBody: unknown;
  const encoder = new TextEncoder();
  api.post = async (endpoint, body) => {
    capturedEndpoint = endpoint;
    capturedBody = body;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"attempt","attemptId":"attempt-123"}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"progress","phase":"receiving","percent":42,"message":"Receiving objects: 42%"}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"complete","project":{"projectId":"project-1","path":"/tmp/workspace/private"}}\n\n'));
        controller.close();
      },
    }), { status: 200 });
  };
  const progress: Array<{ phase: string; percent: number | null; message: string }> = [];

  const project = await cloneWorkspaceWithProgress({
    attemptId: 'attempt-123',
    destinationPath: '/tmp/workspace/private',
    repositoryUrl: 'https://github.com/example/private.git',
    tokenMode: 'new',
    selectedGithubToken: '',
    newGithubToken: 'secret-credential',
  }, {
    onProgress: (event) => progress.push(event),
  });

  assert.equal(capturedEndpoint, '/projects/clone-progress');
  assert.deepEqual(capturedBody, {
    attemptId: 'attempt-123',
    destinationPath: '/tmp/workspace/private',
    repositoryUrl: 'https://github.com/example/private.git',
    newGithubToken: 'secret-credential',
  });
  assert.deepEqual(progress, [{
    phase: 'receiving',
    percent: 42,
    message: 'Receiving objects: 42%',
  }]);
  assert.deepEqual(project, { projectId: 'project-1', path: '/tmp/workspace/private' });
});

test('create project preserves structured code, action, and field errors', async (t) => {
  const originalCreateProject = api.createProject;
  t.after(() => { api.createProject = originalCreateProject; });

  api.createProject = async () => new Response(JSON.stringify({
    success: false,
    error: {
      code: 'PROJECT_PATH_NOT_WRITABLE',
      message: 'The selected folder is not writable.',
      details: { action: 'CHOOSE_ANOTHER', field: 'folder' },
    },
  }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    () => createProjectRequest({ path: '/read-only/project' }),
    (error: unknown) => {
      assert.ok(error instanceof ProjectCreationRequestError);
      assert.equal(error.code, 'PROJECT_PATH_NOT_WRITABLE');
      assert.equal(error.action, 'CHOOSE_ANOTHER');
      assert.equal(error.field, 'folder');
      return true;
    },
  );
});

test('clone progress preserves structured authentication recovery', async (t) => {
  const originalPost = api.post;
  t.after(() => { api.post = originalPost; });
  const encoder = new TextEncoder();
  api.post = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        'data: {"type":"error","code":"AUTH_REQUIRED","action":"CHANGE_CREDENTIAL","field":"credential","attemptId":"attempt-auth","message":"Authentication is required."}\n\n',
      ));
      controller.close();
    },
  }), { status: 200 });

  await assert.rejects(
    () => cloneWorkspaceWithProgress({
      attemptId: 'attempt-auth',
      destinationPath: '/tmp/private',
      repositoryUrl: 'https://gitlab.com/example/private.git',
      tokenMode: 'none',
      selectedGithubToken: '',
      newGithubToken: '',
    }, { onProgress: () => undefined }),
    (error: unknown) => {
      assert.ok(error instanceof ProjectCreationRequestError);
      assert.equal(error.code, 'AUTH_REQUIRED');
      assert.equal(error.action, 'CHANGE_CREDENTIAL');
      assert.equal(error.field, 'credential');
      assert.equal(error.attemptId, 'attempt-auth');
      return true;
    },
  );
});

test('create project ignores malformed recovery metadata', async (t) => {
  const originalCreateProject = api.createProject;
  t.after(() => { api.createProject = originalCreateProject; });

  api.createProject = async () => new Response(JSON.stringify({
    success: false,
    error: {
      code: 'PROJECT_PATH_NOT_WRITABLE',
      message: 'The selected folder is not writable.',
      details: { action: 'DELETE_EVERYTHING', field: 'prototype' },
    },
  }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    () => createProjectRequest({ path: '/read-only/project' }),
    (error: unknown) => {
      assert.ok(error instanceof ProjectCreationRequestError);
      assert.equal(error.action, 'CHOOSE_ANOTHER');
      assert.equal(error.field, 'folder');
      return true;
    },
  );
});

test('clone progress ignores malformed recovery metadata', async (t) => {
  const originalPost = api.post;
  t.after(() => { api.post = originalPost; });
  const encoder = new TextEncoder();
  api.post = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        'data: {"type":"error","code":"AUTH_REQUIRED","action":"DELETE_EVERYTHING","field":"prototype","message":"Authentication is required."}\n\n',
      ));
      controller.close();
    },
  }), { status: 200 });

  await assert.rejects(
    () => cloneWorkspaceWithProgress({
      attemptId: 'attempt-invalid-recovery',
      destinationPath: '/tmp/private',
      repositoryUrl: 'https://gitlab.com/example/private.git',
      tokenMode: 'none',
      selectedGithubToken: '',
      newGithubToken: '',
    }, { onProgress: () => undefined }),
    (error: unknown) => {
      assert.ok(error instanceof ProjectCreationRequestError);
      assert.equal(error.action, 'CHANGE_CREDENTIAL');
      assert.equal(error.field, 'credential');
      return true;
    },
  );
});

test('clone progress maps a null SSE envelope to structured recovery', async (t) => {
  const originalPost = api.post;
  t.after(() => { api.post = originalPost; });
  const encoder = new TextEncoder();
  api.post = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: null\n\n'));
      controller.close();
    },
  }), { status: 200 });

  await assert.rejects(
    () => cloneWorkspaceWithProgress({
      attemptId: 'attempt-null-event',
      destinationPath: '/tmp/private',
      repositoryUrl: 'https://gitlab.com/example/private.git',
      tokenMode: 'none',
      selectedGithubToken: '',
      newGithubToken: '',
    }, { onProgress: () => undefined }),
    (error: unknown) => {
      assert.ok(error instanceof ProjectCreationRequestError);
      assert.equal(error.code, 'GIT_CLONE_FAILED');
      assert.equal(error.action, 'RETRY');
      assert.equal(error.field, 'repositoryUrl');
      assert.match(error.message, /invalid data/i);
      return true;
    },
  );
});

test('clone progress rejects an array as a completed project record', async (t) => {
  const originalPost = api.post;
  t.after(() => { api.post = originalPost; });
  const encoder = new TextEncoder();
  api.post = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"complete","project":[]}\n\n'));
      controller.close();
    },
  }), { status: 200 });

  await assert.rejects(
    () => cloneWorkspaceWithProgress({
      attemptId: 'attempt-array-project',
      destinationPath: '/tmp/private',
      repositoryUrl: 'https://gitlab.com/example/private.git',
      tokenMode: 'none',
      selectedGithubToken: '',
      newGithubToken: '',
    }, { onProgress: () => undefined }),
    (error: unknown) => error instanceof ProjectCreationRequestError
      && error.code === 'GIT_CLONE_FAILED'
      && /invalid data/i.test(error.message),
  );
});

test('cancel clone targets only the originating attempt', async (t) => {
  const originalDelete = api.delete;
  t.after(() => { api.delete = originalDelete; });
  let capturedEndpoint = '';
  api.delete = async (endpoint) => {
    capturedEndpoint = endpoint;
    return new Response(JSON.stringify({ success: true, attemptId: 'attempt/cancel' }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await cancelCloneAttempt('attempt/cancel');

  assert.equal(capturedEndpoint, '/projects/clone-attempts/attempt%2Fcancel');
  assert.equal(result, 'cancelled');
});

test('cancel clone keeps finalization connected when cancellation is too late', async (t) => {
  const originalDelete = api.delete;
  t.after(() => { api.delete = originalDelete; });
  api.delete = async () => new Response(JSON.stringify({
    success: false,
    error: {
      code: 'CLONE_CANCELLATION_TOO_LATE',
      message: 'Clone finalization has started.',
    },
  }), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(await cancelCloneAttempt('attempt-finalizing'), 'too_late');
});

test('cancel clone treats a missing attempt as already terminal', async (t) => {
  const originalDelete = api.delete;
  t.after(() => { api.delete = originalDelete; });
  api.delete = async () => new Response(null, { status: 404 });

  assert.equal(await cancelCloneAttempt('attempt-complete'), 'not_found');
});
