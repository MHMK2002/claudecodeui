import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  cancelCloneProjectAttempt,
  reserveCloneStagingPath,
  startCloneProject,
} from '@/modules/projects/services/project-clone.service.js';
import { AppError } from '@/shared/utils.js';

type TestDependencies = Parameters<typeof startCloneProject>[2];

function buildDependencies(overrides: Partial<NonNullable<TestDependencies>> = {}): NonNullable<TestDependencies> {
  return {
    validatePath: async (requestedPath) => ({ valid: true, resolvedPath: requestedPath }),
    inspectDestination: async () => 'missing',
    isProjectRegistered: async () => false,
    reserveStagingPath: async (stagingPathPrefix) => ({
      path: `${stagingPathPrefix}server-random`,
      identity: { device: 1, inode: 1, changeTimeMs: 1, birthTimeMs: 1 },
    }),
    readPathIdentity: async () => ({
      device: 1,
      inode: 1,
      changeTimeMs: 1,
      birthTimeMs: 1,
    }),
    removePath: async () => undefined,
    finalizeClone: async () => ({ rollback: async () => undefined }),
    getGithubTokenById: async () => ({ github_token: 'token-value' }),
    spawnGitClone: () => {
      throw new Error('spawnGitClone should be overridden in this test');
    },
    registerProject: async () => ({ project: { projectId: 'project-1' } }),
    logError: () => undefined,
    ...overrides,
  };
}

function createMockGitProcess() {
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
    killed: boolean;
  };

  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.killed = false;
  emitter.kill = () => {
    emitter.killed = true;
    emitter.emit('close', null);
  };

  return emitter;
}

const handlers = {
  onProgress: () => undefined,
  onComplete: () => undefined,
};

test('staging reservation removes its empty directory when identity verification fails', async () => {
  const stagingPath = '/workspace/.cloudcli-clone-attempt-random';
  const removedPaths: string[] = [];

  await assert.rejects(
    reserveCloneStagingPath('/workspace/.cloudcli-clone-attempt-', {
      mkdtemp: async () => stagingPath,
      lstat: async () => {
        throw Object.assign(new Error('identity unavailable'), { code: 'EIO' });
      },
      rmdir: async (targetPath) => { removedPaths.push(targetPath); },
    }),
    (error: unknown) => error instanceof AppError && error.code === 'CLONE_STAGING_OWNERSHIP_LOST',
  );

  assert.deepEqual(removedPaths, [stagingPath]);
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}

test('startCloneProject rejects missing and invalid repository inputs with structured fields', async () => {
  await assert.rejects(
    () => startCloneProject({
      attemptId: 'attempt-missing-url',
      destinationPath: '/workspace/repo',
      repositoryUrl: '',
      userId: 1,
    }, handlers, buildDependencies()),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'INVALID_REPOSITORY_URL');
      assert.deepEqual(error.details, { action: 'CHANGE_REPOSITORY', field: 'repositoryUrl' });
      return true;
    },
  );

  await assert.rejects(
    () => startCloneProject({
      attemptId: 'attempt-invalid-url',
      destinationPath: '/workspace/repo',
      repositoryUrl: '--upload-pack=malicious',
      userId: 1,
    }, handlers, buildDependencies()),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_REPOSITORY_URL',
  );
});

test('startCloneProject rejects a non-empty destination without spawning Git', async () => {
  let spawned = false;
  await assert.rejects(
    () => startCloneProject({
      attemptId: 'attempt-non-empty',
      destinationPath: '/workspace/repo',
      repositoryUrl: 'https://github.com/example/repo.git',
      userId: 1,
    }, handlers, buildDependencies({
      inspectDestination: async () => 'non_empty',
      spawnGitClone: () => {
        spawned = true;
        return createMockGitProcess() as never;
      },
    })),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'CLONE_DESTINATION_NOT_EMPTY');
      assert.deepEqual(error.details, { action: 'CHOOSE_ANOTHER', field: 'destination' });
      return true;
    },
  );
  assert.equal(spawned, false);
});

test('startCloneProject clones through an attempt-owned staging path and emits numeric progress', async (t) => {
  const attemptId = 'attempt-success';
  const gitProcess = createMockGitProcess();
  const progress: Array<{ phase: string; percent: number | null; message: string }> = [];
  let completePayload: { project: Record<string, unknown>; message: string } | null = null;
  let spawnedPath = '';
  let finalizedPaths: [string, string] | null = null;
  let registeredPath = '';

  const operation = await startCloneProject({
    attemptId,
    destinationPath: '/workspace/root/repo',
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 1,
  }, {
    onProgress: (event) => progress.push(event),
    onComplete: (payload) => { completePayload = payload; },
  }, buildDependencies({
    spawnGitClone: (_cloneUrl, clonePath) => {
      spawnedPath = clonePath;
      return gitProcess as never;
    },
    finalizeClone: async (stagingPath, destinationPath) => {
      finalizedPaths = [stagingPath, destinationPath];
      return { rollback: async () => undefined };
    },
    registerProject: async (projectPath) => {
      registeredPath = projectPath;
      return { project: { projectId: 'project-1', path: projectPath } };
    },
  }));
  t.after(() => operation.release());

  gitProcess.stderr.write('Receiving objects: 42% (42/100)\r');
  gitProcess.emit('close', 0);
  await operation.waitForCompletion;

  assert.match(path.basename(spawnedPath), new RegExp(`^\\.cloudcli-clone-${attemptId}-.+`));
  assert.deepEqual(finalizedPaths, [spawnedPath, '/workspace/root/repo']);
  assert.equal(registeredPath, '/workspace/root/repo');
  assert.ok(progress.some((event) => event.phase === 'receiving' && event.percent === 42));
  assert.notEqual(completePayload, null);
  assert.equal(
    (completePayload as unknown as { message: string }).message,
    'Repository cloned successfully',
  );
});

test('authentication failure returns credential recovery and removes only attempt staging', async (t) => {
  const attemptId = 'attempt-auth';
  const gitProcess = createMockGitProcess();
  const removedPaths: string[] = [];
  const destinationPath = '/workspace/root/private';

  const operation = await startCloneProject({
    attemptId,
    destinationPath,
    repositoryUrl: 'https://github.com/example/private.git',
    userId: 1,
  }, handlers, buildDependencies({
    spawnGitClone: () => gitProcess as never,
    removePath: async (targetPath) => { removedPaths.push(targetPath); },
  }));
  t.after(() => operation.release());

  gitProcess.stderr.write('fatal: Authentication failed for repository');
  gitProcess.emit('close', 128);

  await assert.rejects(operation.waitForCompletion, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'AUTH_REQUIRED');
    assert.deepEqual(error.details, { action: 'CHANGE_CREDENTIAL', field: 'credential' });
    return true;
  });
  assert.equal(removedPaths.length, 1);
  assert.match(path.basename(removedPaths[0]), new RegExp(`^\\.cloudcli-clone-${attemptId}-.+`));
  assert.notEqual(removedPaths[0], destinationPath);
});

test('clone cleanup preserves a staging path replaced by another writer', async (t) => {
  const attemptId = 'attempt-replaced-staging';
  const gitProcess = createMockGitProcess();
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'cloudcli-clone-ownership-'));
  const replacementMarker = 'replacement-owner.txt';
  let stagingPath = '';
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));

  const operation = await startCloneProject({
    attemptId,
    destinationPath: path.join(workspaceRoot, 'repository'),
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 1,
  }, handlers, buildDependencies({
    reserveStagingPath: async (clonePathPrefix) => {
      const clonePath = `${clonePathPrefix}server-random`;
      mkdirSync(clonePath);
      const stats = statSync(clonePath);
      return {
        path: clonePath,
        identity: {
          device: stats.dev,
          inode: stats.ino,
          changeTimeMs: stats.ctimeMs,
          birthTimeMs: stats.birthtimeMs,
        },
      };
    },
    readPathIdentity: async (targetPath) => {
      if (!existsSync(targetPath)) return null;
      const stats = statSync(targetPath);
      return {
        device: stats.dev,
        inode: stats.ino,
        changeTimeMs: stats.ctimeMs,
        birthTimeMs: stats.birthtimeMs,
      };
    },
    spawnGitClone: (_repositoryUrl, clonePath) => {
      stagingPath = clonePath;
      rmSync(clonePath, { recursive: true, force: true });
      mkdirSync(clonePath);
      writeFileSync(path.join(clonePath, replacementMarker), 'do not delete');
      return gitProcess as never;
    },
    removePath: async (targetPath) => {
      rmSync(targetPath, { recursive: true, force: true });
    },
  }));
  t.after(() => operation.release());

  gitProcess.emit('error', Object.assign(new Error('git failed to start'), { code: 'EIO' }));
  await assert.rejects(operation.waitForCompletion, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'CLONE_STAGING_OWNERSHIP_LOST');
    return true;
  });

  assert.equal(existsSync(path.join(stagingPath, replacementMarker)), true);
});

test('clone cleanup failure returns a structured repairable error', async (t) => {
  const gitProcess = createMockGitProcess();
  const operation = await startCloneProject({
    attemptId: 'attempt-cleanup-failure',
    destinationPath: '/workspace/cleanup-failure',
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 1,
  }, handlers, buildDependencies({
    spawnGitClone: () => gitProcess as never,
    removePath: async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    },
  }));
  t.after(() => operation.release());

  gitProcess.emit('error', Object.assign(new Error('git failed to start'), { code: 'EIO' }));
  await assert.rejects(operation.waitForCompletion, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'CLONE_CLEANUP_REQUIRED');
    assert.deepEqual(error.details, { action: 'CHOOSE_ANOTHER', field: 'destination' });
    return true;
  });
});

test('clone refuses to finalize staging whose ownership changed', async (t) => {
  const gitProcess = createMockGitProcess();
  let finalized = false;
  const operation = await startCloneProject({
    attemptId: 'attempt-staging-ownership',
    destinationPath: '/workspace/staging-ownership',
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 1,
  }, handlers, buildDependencies({
    readPathIdentity: async () => ({
      device: 2,
      inode: 2,
      changeTimeMs: 2,
      birthTimeMs: 2,
    }),
    spawnGitClone: () => gitProcess as never,
    finalizeClone: async () => {
      finalized = true;
      return { rollback: async () => undefined };
    },
  }));
  t.after(() => operation.release());

  gitProcess.emit('close', 0);
  await assert.rejects(
    operation.waitForCompletion,
    (error: unknown) => error instanceof AppError && error.code === 'CLONE_STAGING_OWNERSHIP_LOST',
  );
  assert.equal(finalized, false);
});

test('network failures and missing Git have distinct recovery codes', async (t) => {
  const networkAttempt = 'attempt-network';
  const gitAttempt = 'attempt-no-git';

  const networkProcess = createMockGitProcess();
  const networkOperation = await startCloneProject({
    attemptId: networkAttempt,
    destinationPath: '/workspace/network',
    repositoryUrl: 'https://gitlab.com/example/network.git',
    userId: 1,
  }, handlers, buildDependencies({ spawnGitClone: () => networkProcess as never }));
  networkProcess.stderr.write('fatal: unable to access repository: Could not resolve host');
  networkProcess.emit('close', 128);
  await assert.rejects(
    networkOperation.waitForCompletion,
    (error: unknown) => error instanceof AppError && error.code === 'NETWORK_OFFLINE',
  );

  const missingGitProcess = createMockGitProcess();
  const gitOperation = await startCloneProject({
    attemptId: gitAttempt,
    destinationPath: '/workspace/no-git',
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 1,
  }, handlers, buildDependencies({ spawnGitClone: () => missingGitProcess as never }));
  t.after(() => {
    networkOperation.release();
    gitOperation.release();
  });
  missingGitProcess.emit('error', Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
  await assert.rejects(gitOperation.waitForCompletion, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'GIT_NOT_FOUND');
    assert.deepEqual(error.details, { action: 'INSTALL_GIT', field: 'repositoryUrl' });
    return true;
  });
});

test('cancel rejects as OPERATION_CANCELLED and never removes the destination', async (t) => {
  const attemptId = 'attempt-cancel';
  const gitProcess = createMockGitProcess();
  const removedPaths: string[] = [];
  const destinationPath = '/workspace/cancelled';
  const operation = await startCloneProject({
    attemptId,
    destinationPath,
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 1,
  }, handlers, buildDependencies({
    spawnGitClone: () => gitProcess as never,
    removePath: async (targetPath) => { removedPaths.push(targetPath); },
  }));
  t.after(() => operation.release());

  operation.cancel();

  await assert.rejects(
    operation.waitForCompletion,
    (error: unknown) => error instanceof AppError && error.code === 'OPERATION_CANCELLED',
  );
  assert.equal(gitProcess.killed, true);
  assert.equal(removedPaths.length, 1);
  assert.notEqual(removedPaths[0], destinationPath);
});

test('an attempt can be cancelled during async validation before Git is spawned', async () => {
  const attemptId = 'attempt-cancel-startup';
  let spawned = false;
  const validationGate = createDeferred<void>();
  const startPromise = startCloneProject({
    attemptId,
    destinationPath: '/workspace/startup-cancel',
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 7,
  }, handlers, buildDependencies({
    validatePath: async (requestedPath) => {
      await validationGate.promise;
      return { valid: true, resolvedPath: requestedPath };
    },
    spawnGitClone: () => {
      spawned = true;
      return createMockGitProcess() as never;
    },
  }));

  await Promise.resolve();
  assert.equal(cancelCloneProjectAttempt(attemptId, 7), 'cancelled');
  validationGate.resolve();

  await assert.rejects(
    startPromise,
    (error: unknown) => error instanceof AppError && error.code === 'OPERATION_CANCELLED',
  );
  assert.equal(spawned, false);
});

test('only the authenticated owner can cancel an active attempt', async (t) => {
  const attemptId = 'attempt-owner-bound';
  const gitProcess = createMockGitProcess();
  const operation = await startCloneProject({
    attemptId,
    destinationPath: '/workspace/owner-bound',
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 7,
  }, handlers, buildDependencies({ spawnGitClone: () => gitProcess as never }));
  t.after(() => {
    operation.cancel();
    operation.waitForCompletion.catch(() => undefined);
    operation.release();
  });

  assert.equal(cancelCloneProjectAttempt(attemptId, 8), 'forbidden');
  assert.equal(gitProcess.killed, false);
  assert.equal(cancelCloneProjectAttempt(attemptId, 7), 'cancelled');
  await assert.rejects(operation.waitForCompletion);
});

test('a duplicate active attempt cannot release or cancel another generation', async () => {
  const attemptId = 'attempt-generation-bound';
  const originalProcess = createMockGitProcess();
  const originalOperation = await startCloneProject({
    attemptId,
    destinationPath: '/workspace/generation-bound',
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 7,
  }, handlers, buildDependencies({ spawnGitClone: () => originalProcess as never }));

  await assert.rejects(
    () => startCloneProject({
      attemptId,
      destinationPath: '/workspace/duplicate-generation',
      repositoryUrl: 'https://github.com/example/other.git',
      userId: 7,
    }, handlers, buildDependencies()),
    (error: unknown) => error instanceof AppError && error.code === 'CLONE_ATTEMPT_CONFLICT',
  );

  assert.equal(originalOperation.cancel(), 'cancelled');
  await assert.rejects(
    originalOperation.waitForCompletion,
    (error: unknown) => error instanceof AppError && error.code === 'OPERATION_CANCELLED',
  );
  originalOperation.release();

  const replacementProcess = createMockGitProcess();
  const replacementOperation = await startCloneProject({
    attemptId,
    destinationPath: '/workspace/replacement-generation',
    repositoryUrl: 'https://github.com/example/replacement.git',
    userId: 7,
  }, handlers, buildDependencies({ spawnGitClone: () => replacementProcess as never }));

  assert.equal(originalOperation.cancel(), 'not_found');
  assert.equal(replacementProcess.killed, false);
  assert.equal(replacementOperation.cancel(), 'cancelled');
  await assert.rejects(replacementOperation.waitForCompletion);
  replacementOperation.release();
});

test('cancellation becomes too late as soon as clone finalization starts', async () => {
  const attemptId = 'attempt-finalization-boundary';
  const gitProcess = createMockGitProcess();
  const finalizationStarted = createDeferred<void>();
  const finalizationGate = createDeferred<void>();
  const operation = await startCloneProject({
    attemptId,
    destinationPath: '/workspace/finalization-boundary',
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 7,
  }, handlers, buildDependencies({
    spawnGitClone: () => gitProcess as never,
    finalizeClone: async () => {
      finalizationStarted.resolve();
      await finalizationGate.promise;
      return { rollback: async () => undefined };
    },
  }));

  gitProcess.emit('close', 0);
  await finalizationStarted.promise;

  assert.equal(cancelCloneProjectAttempt(attemptId, 7), 'too_late');
  assert.equal(operation.cancel(), 'too_late');
  assert.equal(gitProcess.killed, false);

  finalizationGate.resolve();
  await operation.waitForCompletion;
  operation.release();
});

test('credentials never appear in the repository URL passed to Git', async (t) => {
  const attemptId = 'attempt-clean-argv';
  const gitProcess = createMockGitProcess();
  let cloneUrl = '';
  let authorizationHeader = '';
  const operation = await startCloneProject({
    attemptId,
    destinationPath: '/workspace/clean-argv',
    repositoryUrl: 'https://github.com/example/private.git',
    githubTokenId: 12,
    userId: 7,
  }, handlers, buildDependencies({
    spawnGitClone: (url, _path, ...extra: unknown[]) => {
      cloneUrl = url;
      authorizationHeader = typeof extra[0] === 'string' ? extra[0] : '';
      return gitProcess as never;
    },
  }));
  t.after(() => operation.release());

  assert.equal(cloneUrl, 'https://github.com/example/private.git');
  assert.doesNotMatch(cloneUrl, /token-value|oauth2|@/);
  assert.match(authorizationHeader, /^Authorization: Basic /);

  operation.cancel();
  await assert.rejects(operation.waitForCompletion);
});

test('insecure HTTP and repository URLs containing userinfo are rejected', async () => {
  for (const [attemptId, repositoryUrl] of [
    ['attempt-http-url', 'http://github.com/example/repo.git'],
    ['attempt-userinfo-url', 'https://user:secret@github.com/example/repo.git'],
  ]) {
    await assert.rejects(
      () => startCloneProject({
        attemptId,
        destinationPath: `/workspace/${attemptId}`,
        repositoryUrl,
        userId: 7,
      }, handlers, buildDependencies()),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_REPOSITORY_URL',
    );
  }
});

test('registration failure rolls back the finalized attempt destination', async (t) => {
  const attemptId = 'attempt-register-rollback';
  const gitProcess = createMockGitProcess();
  let rolledBack = false;
  const operation = await startCloneProject({
    attemptId,
    destinationPath: '/workspace/register-rollback',
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 7,
  }, handlers, buildDependencies({
    spawnGitClone: () => gitProcess as never,
    finalizeClone: async () => ({
      rollback: async () => { rolledBack = true; },
    }) as never,
    registerProject: async () => {
      throw new AppError('database unavailable', {
        code: 'PROJECT_CREATE_FAILED',
        statusCode: 500,
      });
    },
  }));
  t.after(() => operation.release());

  gitProcess.emit('close', 0);
  await assert.rejects(operation.waitForCompletion, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'CLONE_PROJECT_REGISTRATION_FAILED');
    assert.deepEqual(error.details, { action: 'RETRY', field: 'destination' });
    return true;
  });
  assert.equal(rolledBack, true);
});

test('rollback failure requires repair and preserves the open-existing recovery', async (t) => {
  const attemptId = 'attempt-rollback-repair';
  const gitProcess = createMockGitProcess();
  const loggedErrors: Array<{ message: string; error: unknown }> = [];
  const operation = await startCloneProject({
    attemptId,
    destinationPath: '/workspace/rollback-repair',
    repositoryUrl: 'https://github.com/example/repo.git',
    userId: 7,
  }, handlers, buildDependencies({
    spawnGitClone: () => gitProcess as never,
    finalizeClone: async () => ({
      rollback: async () => {
        throw new Error('rollback failed');
      },
    }),
    registerProject: async () => {
      throw new AppError('database unavailable', {
        code: 'PROJECT_CREATE_FAILED',
        statusCode: 500,
      });
    },
    logError: (message, error) => { loggedErrors.push({ message, error }); },
  }));
  t.after(() => operation.release());

  gitProcess.emit('close', 0);
  await assert.rejects(operation.waitForCompletion, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'CLONE_REPAIR_REQUIRED');
    assert.deepEqual(error.details, { action: 'OPEN_EXISTING', field: 'destination' });
    return true;
  });
  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0].message, 'Failed to roll back finalized clone destination.');
});
