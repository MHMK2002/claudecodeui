import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { taskmasterInitializerService } from '@/modules/taskmaster/taskmaster-initializer.service.js';

async function withDirectories(runTest: (root: string, reference: string, project: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'taskmaster-initializer-'));
  const reference = path.join(root, 'reference');
  const project = path.join(root, 'project');
  await mkdir(reference, { recursive: true });
  await mkdir(project, { recursive: true });
  try {
    await runTest(root, reference, project);
  } finally {
    taskmasterInitializerService._test.resetAttempts();
    await rm(root, { recursive: true, force: true });
  }
}

async function writeReferenceProject(reference: string): Promise<void> {
  await mkdir(path.join(reference, '.taskmaster', 'tasks'), { recursive: true });
  await mkdir(path.join(reference, '.claude', 'commands', 'tm'), { recursive: true });
  await writeFile(path.join(reference, '.taskmaster', 'config.json'), JSON.stringify({ models: { main: 'generated-default' } }));
  await writeFile(path.join(reference, '.taskmaster', 'state.json'), '{}');
  await writeFile(path.join(reference, '.taskmaster', 'tasks', 'tasks.json'), JSON.stringify({ master: { tasks: [] } }));
  await writeFile(path.join(reference, '.taskmaster', 'CLAUDE.md'), '# TaskMaster rules');
  await writeFile(path.join(reference, '.claude', 'commands', 'tm', 'next.md'), '# next task');
}

test('validity matrix distinguishes missing, partial, invalid, and valid state', async () => {
  await withDirectories(async (_root, _reference, project) => {
    assert.equal(taskmasterInitializerService.classify(project).status, 'missing');
    await mkdir(path.join(project, '.taskmaster', 'tasks'), { recursive: true });
    assert.equal(taskmasterInitializerService.classify(project).status, 'partial');
    await writeFile(path.join(project, '.taskmaster', 'tasks', 'tasks.json'), '{bad json');
    assert.equal(taskmasterInitializerService.classify(project).status, 'invalid');
    await writeFile(path.join(project, '.taskmaster', 'tasks', 'tasks.json'), '{}');
    await writeFile(path.join(project, '.taskmaster', 'config.json'), '{}');
    await writeFile(path.join(project, '.taskmaster', 'state.json'), '{}');
    await writeFile(path.join(project, '.taskmaster', 'CLAUDE.md'), '# rules');
    assert.equal(taskmasterInitializerService.classify(project).status, 'valid');
  });
});

test('partial repair copies only missing reference artifacts and is idempotent', async () => {
  await withDirectories(async (_root, reference, project) => {
    await mkdir(path.join(reference, 'tasks'), { recursive: true });
    await writeFile(path.join(reference, 'tasks', 'tasks.json'), '{"master":{"tasks":[]}}');
    await writeFile(path.join(reference, 'config.json'), '{"models":{}}');
    await mkdir(path.join(project, 'tasks'), { recursive: true });
    await writeFile(path.join(project, 'tasks', 'tasks.json'), '{"master":{"tasks":[{"id":"7"}]}}');

    const first = taskmasterInitializerService._test.copyMissingTree(reference, project);
    const second = taskmasterInitializerService._test.copyMissingTree(reference, project);

    assert.deepEqual(first, ['config.json']);
    assert.deepEqual(second, []);
    assert.equal(
      await readFile(path.join(project, 'tasks', 'tasks.json'), 'utf8'),
      '{"master":{"tasks":[{"id":"7"}]}}',
    );
  });
});

test('project MCP merge removes placeholders, enables standard tools, and preserves unrelated servers', async () => {
  await withDirectories(async (_root, _reference, project) => {
    await writeFile(path.join(project, '.mcp.json'), JSON.stringify({
      custom: { keep: true },
      mcpServers: {
        existing: { command: 'existing-command', args: ['serve'] },
        'task-master-ai': {
          command: 'npx',
          args: ['-y', 'task-master-ai'],
          env: {
            TASK_MASTER_TOOLS: 'core',
            OPENAI_API_KEY: 'YOUR_OPENAI_KEY_HERE',
            REAL_KEY: 'keep-me',
          },
        },
      },
    }, null, 2));

    const first = taskmasterInitializerService._test.mergeProjectMcp(project);
    const second = taskmasterInitializerService._test.mergeProjectMcp(project);
    const document = JSON.parse(await readFile(path.join(project, '.mcp.json'), 'utf8')) as {
      custom: { keep: boolean };
      mcpServers: Record<string, { env?: Record<string, string> }>;
    };

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(document.custom.keep, true);
    assert.ok(document.mcpServers.existing);
    assert.deepEqual(document.mcpServers['task-master-ai']?.env, {
      REAL_KEY: 'keep-me',
      TASK_MASTER_TOOLS: 'standard',
    });
  });
});

test('Claude instruction merge preserves existing content and adds one import', async () => {
  await withDirectories(async (_root, _reference, project) => {
    const filePath = path.join(project, 'CLAUDE.md');
    await writeFile(filePath, '# Existing instructions\n\nKeep this text.\n');
    const first = taskmasterInitializerService._test.mergeClaudeInstructions(project);
    const second = taskmasterInitializerService._test.mergeClaudeInstructions(project);
    const content = await readFile(filePath, 'utf8');

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.match(content, /Keep this text\./);
    assert.equal(content.match(/@\.\/\.taskmaster\/CLAUDE\.md/g)?.length, 1);
  });
});

test('previewed setup backs up, applies once, streams stages, and preserves existing configuration', async () => {
  await withDirectories(async (_root, reference, project) => {
    await writeReferenceProject(reference);
    await writeFile(path.join(project, 'CLAUDE.md'), '# Existing\n\nKeep me.\n');
    await writeFile(path.join(project, '.mcp.json'), JSON.stringify({
      custom: { keep: true },
      mcpServers: {},
    }));

    const plan = taskmasterInitializerService._test.registerAttemptFromReference(project, reference);
    assert.equal(plan.changesExistingModelDefaults, false);
    assert.deepEqual(plan.modelDefaults, { main: 'generated-default' });
    assert.ok(plan.operations.some((entry) => entry.path === '.taskmaster/config.json'));

    const stages: string[] = [];
    const first = await taskmasterInitializerService.apply(project, plan.attemptId, {
      onProgress: (progress) => stages.push(progress.stage),
    });
    const second = await taskmasterInitializerService.apply(project, plan.attemptId);

    assert.equal(first.after.status, 'valid');
    assert.deepEqual(second, first);
    assert.equal(stages[0], 'backup');
    assert.equal(stages.at(-1), 'success');
    assert.match(await readFile(path.join(project, 'CLAUDE.md'), 'utf8'), /Keep me\./);
    const mcp = JSON.parse(await readFile(path.join(project, '.mcp.json'), 'utf8')) as {
      custom?: { keep?: boolean };
      mcpServers?: Record<string, unknown>;
    };
    assert.equal(mcp.custom?.keep, true);
    assert.ok(mcp.mcpServers?.['task-master-ai']);
  });
});

test('failed confirmed setup restores the exact pre-write project state', async () => {
  await withDirectories(async (_root, reference, project) => {
    await writeReferenceProject(reference);
    await writeFile(path.join(project, 'CLAUDE.md'), '# Original instructions\n');
    const plan = taskmasterInitializerService._test.registerAttemptFromReference(project, reference);
    taskmasterInitializerService._test.forceFailureAt('taskmaster');

    await assert.rejects(
      taskmasterInitializerService.apply(project, plan.attemptId),
      (error: unknown) => (error as { recovery?: string }).recovery === 'REPAIR',
    );
    assert.equal(taskmasterInitializerService.classify(project).status, 'missing');
    assert.equal(await readFile(path.join(project, 'CLAUDE.md'), 'utf8'), '# Original instructions\n');
    await assert.rejects(readFile(path.join(project, '.mcp.json'), 'utf8'));
  });
});

test('cancelled preview performs no writes and cannot be applied later', async () => {
  await withDirectories(async (_root, reference, project) => {
    await writeReferenceProject(reference);
    const plan = taskmasterInitializerService._test.registerAttemptFromReference(project, reference);
    assert.deepEqual(taskmasterInitializerService.cancel(project, plan.attemptId), { cancelled: true });
    await assert.rejects(
      taskmasterInitializerService.apply(project, plan.attemptId),
      (error: unknown) => (error as { code?: string }).code === 'TASKMASTER_ATTEMPT_NOT_FOUND',
    );
    assert.equal(taskmasterInitializerService.classify(project).status, 'missing');
  });
});

test('cancelling a confirmed setup between progress stages rolls back partial writes', async () => {
  await withDirectories(async (_root, reference, project) => {
    await writeReferenceProject(reference);
    await writeFile(path.join(project, 'CLAUDE.md'), '# Before cancel\n');
    const plan = taskmasterInitializerService._test.registerAttemptFromReference(project, reference);

    await assert.rejects(
      taskmasterInitializerService.apply(project, plan.attemptId, {
        onProgress: (progress) => {
          if (progress.stage === 'taskmaster') {
            taskmasterInitializerService.cancel(project, plan.attemptId);
          }
        },
      }),
      (error: unknown) => (error as { code?: string }).code === 'TASKMASTER_INIT_CANCELLED',
    );
    assert.equal(taskmasterInitializerService.classify(project).status, 'missing');
    assert.equal(await readFile(path.join(project, 'CLAUDE.md'), 'utf8'), '# Before cancel\n');
  });
});
