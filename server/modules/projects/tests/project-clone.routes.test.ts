import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createProjectCloneRouter } from '@/modules/projects/project-clone.routes.js';
import { AppError } from '@/shared/utils.js';

type CloneRouteServices = Parameters<typeof createProjectCloneRouter>[0];

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}

async function withCloneServer(
  services: CloneRouteServices,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    (request as typeof request & { user: { id: number } }).user = { id: 7 };
    next();
  });
  app.use('/api/projects', createProjectCloneRouter(services));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function buildServices(overrides: Partial<CloneRouteServices> = {}): CloneRouteServices {
  return {
    startClone: async () => ({
      attemptId: 'attempt-default',
      waitForCompletion: Promise.resolve(),
      cancel: () => 'cancelled',
      release: () => undefined,
    }),
    cancelClone: () => 'not_found',
    ...overrides,
  };
}

test('clone route parses attempt, repository, destination, and emits structured progress', async () => {
  const capturedInputs: Array<Record<string, unknown>> = [];
  let releaseCount = 0;
  const services = buildServices({
    startClone: async (input, handlers) => {
      capturedInputs.push(input);
      handlers.onProgress({ phase: 'receiving', percent: 37, message: 'Receiving objects: 37%' });
      handlers.onComplete({ project: { projectId: 'project-1' }, message: 'Done' });
      return {
        attemptId: input.attemptId,
        waitForCompletion: Promise.resolve(),
        cancel: () => 'cancelled',
        release: () => { releaseCount += 1; },
      };
    },
  });

  await withCloneServer(services, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/clone-progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: 'attempt-route',
        repositoryUrl: 'https://github.com/example/repo.git',
        destinationPath: '/workspace/repo',
      }),
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /"type":"attempt","attemptId":"attempt-route"/);
    assert.match(body, /"type":"progress","phase":"receiving","percent":37/);
    assert.match(body, /"type":"complete","project":\{"projectId":"project-1"\}/);
  });

  assert.equal(capturedInputs.length, 1);
  const routeInput = capturedInputs[0];
  assert.ok(routeInput);
  assert.equal(typeof routeInput.requestGeneration, 'symbol');
  const { requestGeneration: _requestGeneration, ...publicInput } = routeInput;
  assert.deepEqual(publicInput, {
    attemptId: 'attempt-route',
    repositoryUrl: 'https://github.com/example/repo.git',
    destinationPath: '/workspace/repo',
    githubTokenId: null,
    newGithubToken: null,
    userId: 7,
  });
  assert.equal(releaseCount, 1);
});

test('clone route preserves structured errors in the SSE payload', async () => {
  const services = buildServices({
    startClone: async () => {
      throw new AppError('Authentication is required.', {
        code: 'AUTH_REQUIRED',
        statusCode: 401,
        details: { action: 'CHANGE_CREDENTIAL', field: 'credential' },
      });
    },
  });

  await withCloneServer(services, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/clone-progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: 'attempt-auth',
        repositoryUrl: 'https://github.com/example/private.git',
        destinationPath: '/workspace/private',
      }),
    });
    const body = await response.text();

    assert.match(body, /"code":"AUTH_REQUIRED"/);
    assert.match(body, /"action":"CHANGE_CREDENTIAL"/);
    assert.match(body, /"field":"credential"/);
    assert.match(body, /"attemptId":"attempt-auth"/);
  });
});

test('cancel route addresses exactly one attempt', async () => {
  const cancelled: string[] = [];
  const owners: Array<number | string> = [];
  const services = buildServices({
    cancelClone: (attemptId, userId) => {
      cancelled.push(attemptId);
      owners.push(userId);
      return 'cancelled' as never;
    },
  });

  await withCloneServer(services, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/clone-attempts/attempt-7`, {
      method: 'DELETE',
    });
    const payload = await response.json() as { success: boolean; attemptId: string };

    assert.equal(response.status, 202);
    assert.deepEqual(payload, { success: true, attemptId: 'attempt-7' });
  });
  assert.deepEqual(cancelled, ['attempt-7']);
  assert.deepEqual(owners, [7]);
});

test('disconnect before startClone resolves cancels only the request generation', async () => {
  let startGeneration: symbol | null = null;
  const startCloneCalled = createDeferred<void>();
  const cancellationObserved = createDeferred<void>();
  const releaseObserved = createDeferred<void>();
  const startCloneGate = createDeferred<Awaited<ReturnType<NonNullable<CloneRouteServices>['startClone']>>>();
  const services = buildServices({
    startClone: async (input) => {
      startGeneration = input.requestGeneration ?? null;
      startCloneCalled.resolve();
      return startCloneGate.promise;
    },
    cancelClone: (attemptId, userId, generation) => {
      assert.equal(attemptId, 'attempt-disconnect');
      assert.equal(userId, 7);
      assert.equal(generation, startGeneration);
      cancellationObserved.resolve();
      return 'cancelled';
    },
  });

  await withCloneServer(services, async (baseUrl) => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/projects/clone-progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: 'attempt-disconnect',
        repositoryUrl: 'https://github.com/example/repo.git',
        destinationPath: '/workspace/repo',
      }),
      signal: controller.signal,
    });
    const bodyPromise = response.text();
    await startCloneCalled.promise;
    controller.abort();
    await assert.rejects(bodyPromise);
    await cancellationObserved.promise;

    startCloneGate.resolve({
      attemptId: 'attempt-disconnect',
      waitForCompletion: Promise.resolve(),
      cancel: () => 'cancelled',
      release: () => { releaseObserved.resolve(); },
    });
    await releaseObserved.promise;
  });
});

test('cancel route reports when finalization has already started', async () => {
  const services = buildServices({ cancelClone: () => 'too_late' });

  await withCloneServer(services, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/clone-attempts/attempt-finalizing`, {
      method: 'DELETE',
    });
    const payload = await response.json() as {
      success: boolean;
      error: { code: string };
    };

    assert.equal(response.status, 409);
    assert.equal(payload.success, false);
    assert.equal(payload.error.code, 'CLONE_CANCELLATION_TOO_LATE');
  });
});

test('a conflicting request never releases an attempt it did not acquire', async () => {
  const services = buildServices({
    startClone: async () => {
      throw new AppError('Attempt already active', {
        code: 'CLONE_ATTEMPT_CONFLICT',
        statusCode: 409,
      });
    },
  });

  await withCloneServer(services, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/clone-progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: 'attempt-conflict',
        repositoryUrl: 'https://github.com/example/repo.git',
        destinationPath: '/workspace/repo',
      }),
    });
    assert.match(await response.text(), /CLONE_ATTEMPT_CONFLICT/);
  });
});
