import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import * as fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import crossSpawn from 'cross-spawn';
import express, { type Request } from 'express';

import {
  createGitCommitMessageService,
  GitCommitMessageError,
} from '@/modules/git/git-commit-message.service.js';
import { createGitRouter } from '@/modules/git/git.routes.js';
import type { ResolvedProviderSelection } from '@/shared/types.js';

const execFileAsync = promisify(execFile);
const selection: ResolvedProviderSelection = {
  provider: 'codex',
  providerProfileId: 12,
  model: 'gpt-test',
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd })).stdout;
}

async function repository(): Promise<string> {
  const cwd = await fs.mkdtemp(join(tmpdir(), 'cloudcli-commit-route-test-'));
  await git(cwd, 'init');
  await git(cwd, 'config', 'user.email', 'test@example.com');
  await git(cwd, 'config', 'user.name', 'Test User');
  await fs.writeFile(join(cwd, 'app.txt'), 'base\n');
  await git(cwd, 'add', '--', 'app.txt');
  await git(cwd, 'commit', '-m', 'feat: baseline');
  return cwd;
}

type GitRouterDependencies = Parameters<typeof createGitRouter>[0];

async function startRouter(dependencies: GitRouterDependencies) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    (request as Request & { user?: { id: number } }).user = { id: 7 };
    next();
  });
  app.use('/api/git', createGitRouter(dependencies));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/git`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function unexpectedSpawn() {
  const child = new EventEmitter();
  process.nextTick(() => child.emit('error', new Error('unexpected spawn')));
  return child;
}

test('generation validates the typed request, returns no-store, and reports the exact used selection', async () => {
  const calls: unknown[] = [];
  const service = {
    async generate(input: unknown) {
      calls.push(input);
      return {
        message: 'feat(git): generate a message',
        snapshotId: 'a'.repeat(64),
        selection,
        analysis: {
          totalStagedFiles: 2,
          sampledFiles: 2,
          recentSubjects: 4,
          truncated: false,
        },
      };
    },
    async validateCommitSnapshot() {
      throw new Error('unexpected commit validation');
    },
  } as unknown as GitRouterDependencies['commitMessageService'];
  const app = await startRouter({
    fileSystem: fs,
    spawnProcess: unexpectedSpawn as unknown as GitRouterDependencies['spawnProcess'],
    resolveProjectPathById: () => '/repo',
    commitMessageService: service,
  });

  try {
    const response = await fetch(`${app.baseUrl}/generate-commit-message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project: 'project-1',
        files: ['src/app.ts', 'src/view.tsx'],
        selection,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      success: true,
      message: 'feat(git): generate a message',
      snapshotId: 'a'.repeat(64),
      selection,
      analysis: {
        totalStagedFiles: 2,
        sampledFiles: 2,
        recentSubjects: 4,
        truncated: false,
      },
    });
    assert.deepEqual(calls, [{
      projectId: 'project-1',
      expectedFiles: ['src/app.ts', 'src/view.tsx'],
      selection,
      userId: 7,
      signal: (calls[0] as { signal: AbortSignal }).signal,
    }]);
    assert.equal((calls[0] as { signal: AbortSignal }).signal instanceof AbortSignal, true);
  } finally {
    await app.close();
  }
});

test('generation maps staged conflicts and provider failures without fake success output', async () => {
  for (const failure of [
    new GitCommitMessageError(
      'STAGED_CHANGES_CHANGED',
      'Staged changes changed',
      409,
      'REVIEW_STAGED_CHANGES',
    ),
    new GitCommitMessageError(
      'PROVIDER_UNAVAILABLE',
      'Codex is unavailable',
      409,
      'OPEN_AGENT_SETTINGS',
    ),
  ]) {
    const service = {
      async generate() { throw failure; },
      async validateCommitSnapshot() { throw new Error('unexpected'); },
    } as unknown as GitRouterDependencies['commitMessageService'];
    const app = await startRouter({
      fileSystem: fs,
      spawnProcess: unexpectedSpawn as unknown as GitRouterDependencies['spawnProcess'],
      resolveProjectPathById: () => '/repo',
      commitMessageService: service,
    });
    try {
      const response = await fetch(`${app.baseUrl}/generate-commit-message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: 'project-1', files: ['app.ts'], selection }),
      });
      const body = await response.json() as Record<string, unknown>;
      assert.equal(response.status, failure.statusCode);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(body.success, false);
      assert.equal(body.code, failure.code);
      assert.equal('message' in body, false);
    } finally {
      await app.close();
    }
  }
});

test('generation rejects malformed project/files/provider/profile/model input before service execution', async () => {
  let calls = 0;
  const service = {
    async generate() { calls += 1; throw new Error('unexpected'); },
    async validateCommitSnapshot() { throw new Error('unexpected'); },
  } as unknown as GitRouterDependencies['commitMessageService'];
  const app = await startRouter({
    fileSystem: fs,
    spawnProcess: unexpectedSpawn as unknown as GitRouterDependencies['spawnProcess'],
    resolveProjectPathById: () => '/repo',
    commitMessageService: service,
  });
  const requests = [
    {},
    { project: 'project-1', files: [], selection },
    { project: 'project-1', files: ['app.ts', 'app.ts'], selection },
    { project: 'project-1', files: ['app.ts'], selection: { ...selection, provider: 'other' } },
    { project: 'project-1', files: ['app.ts'], selection: { ...selection, providerProfileId: '12' } },
    { project: 'project-1', files: ['app.ts'], selection: { ...selection, model: '' } },
  ];
  try {
    for (const body of requests) {
      const response = await fetch(`${app.baseUrl}/generate-commit-message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await response.json() as { code: string }).code, 'INVALID_GENERATION_REQUEST');
    }
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});

test('client disconnect aborts the backend generation signal without writing a response', async () => {
  let releaseStarted: (() => void) | null = null;
  const started = new Promise<void>((resolve) => { releaseStarted = resolve; });
  let backendAborted = false;
  const service = {
    async generate(input: { signal: AbortSignal }) {
      releaseStarted?.();
      return new Promise((_resolve, reject) => {
        const abort = () => {
          backendAborted = true;
          reject(new GitCommitMessageError(
            'GENERATION_CANCELLED',
            'Generation cancelled',
            499,
            'RETRY',
          ));
        };
        if (input.signal.aborted) abort();
        else input.signal.addEventListener('abort', abort, { once: true });
      });
    },
    async validateCommitSnapshot() { throw new Error('unexpected'); },
  } as unknown as GitRouterDependencies['commitMessageService'];
  const app = await startRouter({
    fileSystem: fs,
    spawnProcess: unexpectedSpawn as unknown as GitRouterDependencies['spawnProcess'],
    resolveProjectPathById: () => '/repo',
    commitMessageService: service,
  });
  const controller = new AbortController();
  try {
    const request = fetch(`${app.baseUrl}/generate-commit-message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'project-1', files: ['app.ts'], selection }),
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await assert.rejects(request, /abort/i);
    for (let attempt = 0; attempt < 20 && !backendAborted; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(backendAborted, true);
  } finally {
    await app.close();
  }
});

test('commit never restages a mixed file and commits only the reviewed index', async () => {
  const cwd = await repository();
  try {
    await fs.writeFile(join(cwd, 'app.txt'), 'base\nstaged line\n');
    await git(cwd, 'add', '--', 'app.txt');
    await fs.writeFile(join(cwd, 'app.txt'), 'base\nstaged line\nunstaged line\n');
    const commitMessageService = createGitCommitMessageService({
      spawnProcess: crossSpawn,
      resolveProjectPathById: () => cwd,
      textCompletion: { complete: async () => { throw new Error('unexpected generation'); } },
    });
    const app = await startRouter({
      fileSystem: fs,
      spawnProcess: crossSpawn,
      resolveProjectPathById: () => cwd,
      commitMessageService,
    });
    try {
      const response = await fetch(`${app.baseUrl}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project: 'project-1',
          message: 'feat: commit staged content',
          files: ['app.txt'],
        }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json() as { success: boolean }).success, true);
      assert.equal(await git(cwd, 'show', 'HEAD:app.txt'), 'base\nstaged line\n');
      assert.equal(await fs.readFile(join(cwd, 'app.txt'), 'utf8'), 'base\nstaged line\nunstaged line\n');
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('commit returns 409 and creates no commit when the generated snapshot is stale', async () => {
  const cwd = await repository();
  try {
    await fs.writeFile(join(cwd, 'app.txt'), 'first staged value\n');
    await git(cwd, 'add', '--', 'app.txt');
    const commitMessageService = createGitCommitMessageService({
      spawnProcess: crossSpawn,
      resolveProjectPathById: () => cwd,
      textCompletion: { complete: async () => { throw new Error('unexpected generation'); } },
    });
    const original = await commitMessageService.inspectSnapshot({
      projectId: 'project-1',
      expectedFiles: ['app.txt'],
    });
    await fs.writeFile(join(cwd, 'app.txt'), 'second staged value\n');
    await git(cwd, 'add', '--', 'app.txt');
    const before = (await git(cwd, 'rev-parse', 'HEAD')).trim();
    const app = await startRouter({
      fileSystem: fs,
      spawnProcess: crossSpawn,
      resolveProjectPathById: () => cwd,
      commitMessageService,
    });
    try {
      const response = await fetch(`${app.baseUrl}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project: 'project-1',
          message: 'feat: stale message',
          files: ['app.txt'],
          expectedSnapshotId: original.snapshotId,
        }),
      });
      const body = await response.json() as { success: boolean; code: string };
      assert.equal(response.status, 409);
      assert.deepEqual(body, {
        success: false,
        code: 'STAGED_CHANGES_CHANGED',
        error: 'Staged changes changed',
        details: 'Review the latest staged changes before committing.',
        action: 'REVIEW_STAGED_CHANGES',
      });
      assert.equal((await git(cwd, 'rev-parse', 'HEAD')).trim(), before);
    } finally {
      await app.close();
    }
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
