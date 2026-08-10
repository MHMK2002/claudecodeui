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
    await rm(root, { recursive: true, force: true });
  }
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

