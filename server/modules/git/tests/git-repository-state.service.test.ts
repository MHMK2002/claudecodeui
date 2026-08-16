import assert from 'node:assert/strict';
import test from 'node:test';

import { createGitRepositoryStateService } from '@/modules/git/git-repository-state.service.js';

test('repository state reports conflicts and rebase lifecycle using Git-owned paths', async () => {
  const calls: string[][] = [];
  let conflicts = 'src/a.ts\nsrc/b.ts\n';
  const service = createGitRepositoryStateService({
    runGit: async (_command, args) => {
      calls.push(args);
      if (args[0] === 'diff') return { stdout: conflicts, stderr: '' };
      if (args.at(-1) === 'rebase-merge') return { stdout: '.git/rebase-merge\n', stderr: '' };
      if (args.at(-1) === 'rebase-apply') return { stdout: '.git/rebase-apply\n', stderr: '' };
      return { stdout: '', stderr: '' };
    },
    access: async (candidate) => {
      if (!candidate.endsWith('.git/rebase-merge')) throw new Error('missing');
    },
  });

  assert.deepEqual(await service.inspect('/workspace/repo'), {
    operation: 'rebase',
    conflicts: ['src/a.ts', 'src/b.ts'],
  });
  await assert.rejects(
    service.continueOperation('/workspace/repo', 'rebase'),
    /resolve all conflicts manually/,
  );
  assert.equal(calls.some((args) => args[0] === 'rebase' && args[1] === '--continue'), false);

  conflicts = '';
  await service.continueOperation('/workspace/repo', 'rebase');
  assert.equal(calls.some((args) => args[0] === 'rebase' && args[1] === '--continue'), true);

  await service.abortOperation('/workspace/repo', 'rebase');
  assert.equal(calls.some((args) => args[0] === 'rebase' && args[1] === '--abort'), true);
});
