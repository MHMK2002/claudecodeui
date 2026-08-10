import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { taskmasterWorkflowService } from '@/modules/taskmaster/taskmaster-workflow.service.js';

type TaskRecord = {
  id: string;
  title: string;
  description: string;
  details: string;
  testStrategy: string;
  priority: string;
  dependencies: string[];
  status: string;
  subtasks: unknown[];
};

async function withFixture(runTest: (projectPath: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'taskmaster-workflow-'));
  const projectPath = path.join(tempDirectory, 'project');
  const databasePath = path.join(tempDirectory, 'auth.db');
  await mkdir(path.join(projectPath, '.taskmaster', 'tasks'), { recursive: true });
  await writeFile(
    path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json'),
    JSON.stringify({ master: { tasks: [], metadata: { taskCount: 0 } } }, null, 2),
  );

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();
  try {
    await runTest(projectPath);
  } finally {
    taskmasterWorkflowService._test.resetRunCli();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function readTasks(projectPath: string): Promise<TaskRecord[]> {
  const document = JSON.parse(
    await readFile(path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json'), 'utf8'),
  ) as { master: { tasks: TaskRecord[]; metadata: { taskCount: number } } };
  return document.master.tasks;
}

function installFakeTaskMaster(projectPath: string, options: { throwAfterAddOnce?: boolean } = {}) {
  let addCount = 0;
  let throwAfterAdd = options.throwAfterAddOnce === true;
  taskmasterWorkflowService._test.setRunCli(async (args: string[]) => {
    const filePath = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
    const document = JSON.parse(await readFile(filePath, 'utf8')) as {
      master: { tasks: TaskRecord[]; metadata: { taskCount: number } };
    };
    if (args[0] === 'add-task') {
      addCount += 1;
      const readArg = (flag: string) => args[args.indexOf(flag) + 1] ?? '';
      const dependencies = args.includes('--dependencies')
        ? readArg('--dependencies').split(',').filter(Boolean)
        : [];
      document.master.tasks.push({
        id: String(document.master.tasks.length + 1),
        title: readArg('--title'),
        description: readArg('--description'),
        details: readArg('--details'),
        testStrategy: '',
        priority: readArg('--priority'),
        dependencies,
        status: 'pending',
        subtasks: [],
      });
      document.master.metadata.taskCount = document.master.tasks.length;
      await writeFile(filePath, JSON.stringify(document, null, 2));
      if (throwAfterAdd) {
        throwAfterAdd = false;
        throw new Error('simulated crash after add-task side effect');
      }
      return { stdout: 'created', stderr: '' };
    }
    if (args[0] === 'set-status') {
      const taskId = args.find((entry) => entry.startsWith('--id='))?.slice(5);
      const status = args.find((entry) => entry.startsWith('--status='))?.slice(9);
      const task = document.master.tasks.find((entry) => entry.id === taskId);
      if (!task || !status) throw new Error('missing fake task');
      task.status = status;
      await writeFile(filePath, JSON.stringify(document, null, 2));
      return { stdout: 'updated', stderr: '' };
    }
    throw new Error(`unexpected fake CLI call: ${args.join(' ')}`);
  });
  return { getAddCount: () => addCount };
}

async function startActiveIntake(projectPath: string) {
  const created = await taskmasterWorkflowService.createIntake({
    projectPath,
    projectId: 'project-1',
    userId: 1,
    brief: 'Add a durable upload flow, but ask about any material ambiguity first.',
    provider: 'claude',
    providerProfileId: null,
  });
  sessionsDb.createAppSession('intake-session', 'claude', projectPath);
  const bound = await taskmasterWorkflowService.bindIntakeSession({
    projectPath,
    intakeId: created.intake.id,
    userId: 1,
    sessionId: 'intake-session',
  });
  const dispatch = await taskmasterWorkflowService.authorizeDispatch({
    projectPath,
    userId: 1,
    sessionId: 'intake-session',
    workflowMessage: {
      kind: 'intake',
      id: created.intake.id,
      contentHash: bound.contentHash,
    },
    content: bound.prompt,
  });
  dispatch.onFirstProviderEvent();
  return created.intake.id;
}

async function writeReadyProposal(projectPath: string, intakeId: string) {
  const proposal = {
    intakeId,
    title: 'Implement durable uploads',
    description: 'Add an upload flow with explicit retry behavior.',
    details: 'Preserve existing session behavior.',
    testStrategy: 'Cover success, retry, and validation failures.',
    priority: 'high',
    dependencies: [],
    subtasks: [{ title: 'Add backend contract' }],
    clarificationAnswers: [{ question: 'Retry?', answer: 'Yes, explicit retry.' }],
    acceptedDecisions: [{ decision: 'Keep the existing gateway.' }],
    acceptanceCriteria: ['Failed delivery remains retryable.'],
    unresolvedQuestions: [],
    projectMetadata: { projectId: 'project-1' },
    taskMetadata: { source: 'cloudcli-intake' },
  };
  const proposalFile = path.join(projectPath, '.taskmaster', 'intakes', `${intakeId}.proposal.json`);
  await mkdir(path.dirname(proposalFile), { recursive: true });
  await writeFile(proposalFile, JSON.stringify(proposal, null, 2));
}

test('intake prompt forbids guessing and writes while using the backend proposal transport', async () => {
  await withFixture(async (projectPath) => {
    const result = await taskmasterWorkflowService.createIntake({
      projectPath,
      projectId: 'project-1',
      userId: 1,
      brief: 'Build a feature.',
      provider: 'codex',
      providerProfileId: null,
    });
    assert.match(result.prompt, /never guess/i);
    assert.match(result.prompt, /Do not implement/i);
    assert.match(result.prompt, /enforced as read-only/i);
    assert.match(result.prompt, /<cloudcli-task-proposal>/i);
    assert.match(result.prompt, new RegExp(`${result.intake.id}\\.proposal\\.json`));
    assert.match(result.prompt, /separate explicit Approve action/i);
  });
});

test('intake runtime is read-only and only the backend persists a tagged proposal', async () => {
  await withFixture(async (projectPath) => {
    const created = await taskmasterWorkflowService.createIntake({
      projectPath,
      projectId: 'project-1',
      userId: 1,
      brief: 'Build a feature after clarification.',
      provider: 'codex',
      providerProfileId: null,
    });
    sessionsDb.createAppSession('read-only-intake', 'codex', projectPath);
    await taskmasterWorkflowService.bindIntakeSession({
      projectPath,
      intakeId: created.intake.id,
      userId: 1,
      sessionId: 'read-only-intake',
    });
    const policy = taskmasterWorkflowService.getSessionRuntimePolicy({
      projectPath,
      sessionId: 'read-only-intake',
    });
    assert.equal(policy?.permissionMode, 'plan');

    const proposal = {
      intakeId: created.intake.id,
      title: 'Clarified feature',
      description: 'Implement only after explicit approval.',
      details: 'Preserve existing behavior.',
      testStrategy: 'Cover the approved behavior.',
      priority: 'medium',
      dependencies: [],
      subtasks: [],
      clarificationAnswers: [],
      acceptedDecisions: [],
      acceptanceCriteria: ['The approved behavior is verified.'],
      unresolvedQuestions: [],
      projectMetadata: { projectId: 'project-1' },
      taskMetadata: { source: 'cloudcli-intake' },
    };
    policy?.onProviderEvent({ kind: 'stream_delta', content: '<cloudcli-task-proposal>' });
    await policy?.onProviderEvent({
      kind: 'text',
      role: 'assistant',
      content: `${JSON.stringify(proposal)}</cloudcli-task-proposal>`,
    });

    const persisted = JSON.parse(await readFile(
      path.join(projectPath, '.taskmaster', 'intakes', `${created.intake.id}.proposal.json`),
      'utf8',
    )) as { title?: string };
    assert.equal(persisted.title, 'Clarified feature');
    const listed = await taskmasterWorkflowService.listIntakes({ projectPath, userId: 1 });
    assert.equal(listed[0]?.proposalReady, true);
  });
});

test('proposal transport rejects a symlinked intake directory', async () => {
  await withFixture(async (projectPath) => {
    const created = await taskmasterWorkflowService.createIntake({
      projectPath,
      projectId: 'project-1',
      userId: 1,
      brief: 'Build a feature.',
      provider: 'claude',
      providerProfileId: null,
    });
    sessionsDb.createAppSession('symlink-intake', 'claude', projectPath);
    await taskmasterWorkflowService.bindIntakeSession({
      projectPath,
      intakeId: created.intake.id,
      userId: 1,
      sessionId: 'symlink-intake',
    });
    const intakeDirectory = path.join(projectPath, '.taskmaster', 'intakes');
    const outsideDirectory = path.join(path.dirname(projectPath), 'outside-intakes');
    await mkdir(outsideDirectory, { recursive: true });
    await symlink(outsideDirectory, intakeDirectory, 'dir');
    await writeFile(path.join(outsideDirectory, `${created.intake.id}.proposal.json`), JSON.stringify({
      intakeId: created.intake.id,
      title: 'Unsafe proposal',
      description: 'Must be rejected.',
      unresolvedQuestions: [],
    }));

    assert.throws(
      () => taskmasterWorkflowService._test.readCanonicalProposal(projectPath, created.intake.id),
      (error: unknown) => (error as { code?: string }).code === 'INVALID_PROPOSAL_PATH',
    );
    const policy = taskmasterWorkflowService.getSessionRuntimePolicy({
      projectPath,
      sessionId: 'symlink-intake',
    });
    await policy?.onProviderEvent({
      kind: 'text',
      role: 'assistant',
      content: `<cloudcli-task-proposal>${JSON.stringify({
        intakeId: created.intake.id,
        title: 'Overwrite attempt',
        description: 'Must not escape the project.',
        unresolvedQuestions: [],
      })}</cloudcli-task-proposal>`,
    });
    const outside = JSON.parse(await readFile(
      path.join(outsideDirectory, `${created.intake.id}.proposal.json`),
      'utf8',
    )) as { title?: string };
    assert.equal(outside.title, 'Unsafe proposal');
  });
});

test('approval is blocked until intake delivery is accepted and ambiguity is resolved', async () => {
  await withFixture(async (projectPath) => {
    const created = await taskmasterWorkflowService.createIntake({
      projectPath,
      projectId: 'project-1',
      userId: 1,
      brief: 'Build a feature.',
      provider: 'claude',
      providerProfileId: null,
    });
    await writeReadyProposal(projectPath, created.intake.id);
    const listed = await taskmasterWorkflowService.listIntakes({ projectPath, userId: 1 });
    await assert.rejects(
      taskmasterWorkflowService.approveIntake({
        projectPath,
        intakeId: created.intake.id,
        userId: 1,
        approved: true,
        proposalHash: listed[0]?.proposalHash,
        idempotencyKey: 'approval-not-active',
      }),
      (error: unknown) => (error as { code?: string }).code === 'INTAKE_NOT_ACTIVE',
    );

    const intakeId = await startActiveIntake(projectPath);
    const proposalFile = path.join(projectPath, '.taskmaster', 'intakes', `${intakeId}.proposal.json`);
    await mkdir(path.dirname(proposalFile), { recursive: true });
    await writeFile(proposalFile, JSON.stringify({
      intakeId,
      title: 'Still ambiguous',
      description: 'Missing a material answer.',
      unresolvedQuestions: ['Which persistence model?'],
    }));
    const ambiguous = await taskmasterWorkflowService.listIntakes({ projectPath, userId: 1 });
    const record = ambiguous.find((entry: { id: string }) => entry.id === intakeId);
    assert.equal(record?.proposalReady, false);
    await assert.rejects(
      taskmasterWorkflowService.approveIntake({
        projectPath,
        intakeId,
        userId: 1,
        approved: true,
        proposalHash: record?.proposalHash,
        idempotencyKey: 'approval-ambiguous',
      }),
      (error: unknown) => (error as { code?: string }).code === 'PROPOSAL_NOT_READY',
    );
    assert.equal((await readTasks(projectPath)).length, 0);
  });
});

test('approval adopts a marked task after an add-task crash and concurrent retries create exactly one task', async () => {
  await withFixture(async (projectPath) => {
    const intakeId = await startActiveIntake(projectPath);
    await writeReadyProposal(projectPath, intakeId);
    const listed = await taskmasterWorkflowService.listIntakes({ projectPath, userId: 1 });
    const proposalHash = listed.find((entry: { id: string }) => entry.id === intakeId)?.proposalHash;
    assert.ok(proposalHash);
    const fake = installFakeTaskMaster(projectPath, { throwAfterAddOnce: true });
    const request = () => taskmasterWorkflowService.approveIntake({
      projectPath,
      intakeId,
      userId: 1,
      approved: true,
      proposalHash,
      idempotencyKey: 'approval-exactly-once',
    });
    const [first, second] = await Promise.all([request(), request()]);
    assert.equal(first.approval.taskId, '1');
    assert.equal(second.approval.taskId, '1');
    assert.equal(fake.getAddCount(), 1);
    const tasks = await readTasks(projectPath);
    assert.equal(tasks.length, 1);
    assert.match(tasks[0]?.details ?? '', /cloudcli-intake:/);
    assert.equal(tasks[0]?.status, 'pending');
    assert.throws(
      () => taskmasterWorkflowService.assertStatusChangeAllowed({
        projectPath,
        taskId: '1',
        status: 'in-progress',
      }),
      (error: unknown) => (error as { code?: string }).code === 'IMPLEMENTATION_LAUNCH_REQUIRED',
    );
  });
});

test('launch snapshot includes every required field and failed delivery leaves the task pending', async () => {
  await withFixture(async (projectPath) => {
    const intakeId = await startActiveIntake(projectPath);
    await writeReadyProposal(projectPath, intakeId);
    const listed = await taskmasterWorkflowService.listIntakes({ projectPath, userId: 1 });
    const proposalHash = listed.find((entry: { id: string }) => entry.id === intakeId)?.proposalHash;
    installFakeTaskMaster(projectPath);
    await taskmasterWorkflowService.approveIntake({
      projectPath,
      intakeId,
      userId: 1,
      approved: true,
      proposalHash,
      idempotencyKey: 'approval-for-launch',
    });
    const attempt = await taskmasterWorkflowService.beginLaunch({
      projectPath,
      taskId: '1',
      userId: 1,
      provider: 'codex',
      providerProfileId: null,
      idempotencyKey: 'launch-for-failure',
    });
    assert.deepEqual(Object.keys(attempt.snapshot).sort(), [
      'acceptanceCriteria',
      'acceptedDecisions',
      'clarification',
      'dependencies',
      'description',
      'details',
      'id',
      'projectMetadata',
      'proposalHash',
      'subtasks',
      'taskMetadata',
      'testStrategy',
      'title',
    ]);
    assert.equal(attempt.snapshot.testStrategy, 'Cover success, retry, and validation failures.');
    assert.deepEqual(attempt.snapshot.acceptanceCriteria, ['Failed delivery remains retryable.']);
    sessionsDb.createAppSession('implementation-session', 'codex', projectPath);
    await taskmasterWorkflowService.bindLaunchSession({
      projectPath,
      attemptId: attempt.id,
      userId: 1,
      sessionId: 'implementation-session',
    });
    const dispatch = await taskmasterWorkflowService.authorizeDispatch({
      projectPath,
      userId: 1,
      sessionId: 'implementation-session',
      workflowMessage: { kind: 'implementation', id: attempt.id, contentHash: attempt.contentHash },
      content: attempt.content,
    });
    await dispatch.onFailure('simulated provider startup failure');
    const failed = await taskmasterWorkflowService.getLaunch({ projectPath, attemptId: attempt.id, userId: 1 });
    assert.equal(failed.status, 'failed');
    assert.equal((await readTasks(projectPath))[0]?.status, 'pending');
  });
});

test('first provider event reconciles one launch to in-progress and persists its session link', async () => {
  await withFixture(async (projectPath) => {
    const intakeId = await startActiveIntake(projectPath);
    await writeReadyProposal(projectPath, intakeId);
    const listed = await taskmasterWorkflowService.listIntakes({ projectPath, userId: 1 });
    const proposalHash = listed.find((entry: { id: string }) => entry.id === intakeId)?.proposalHash;
    installFakeTaskMaster(projectPath);
    await taskmasterWorkflowService.approveIntake({
      projectPath,
      intakeId,
      userId: 1,
      approved: true,
      proposalHash,
      idempotencyKey: 'approval-for-success',
    });
    const attempt = await taskmasterWorkflowService.beginLaunch({
      projectPath,
      taskId: '1',
      userId: 1,
      provider: 'claude',
      providerProfileId: null,
      idempotencyKey: 'launch-for-success',
    });
    sessionsDb.createAppSession('fresh-implementation', 'claude', projectPath);
    await taskmasterWorkflowService.bindLaunchSession({
      projectPath,
      attemptId: attempt.id,
      userId: 1,
      sessionId: 'fresh-implementation',
    });
    const dispatch = await taskmasterWorkflowService.authorizeDispatch({
      projectPath,
      userId: 1,
      sessionId: 'fresh-implementation',
      workflowMessage: { kind: 'implementation', id: attempt.id, contentHash: attempt.contentHash },
      content: attempt.content,
    });
    dispatch.onFirstProviderEvent();
    const linked = await taskmasterWorkflowService.getLaunch({ projectPath, attemptId: attempt.id, userId: 1 });
    assert.equal(linked.status, 'linked');
    assert.equal(linked.sessionId, 'fresh-implementation');
    assert.equal((await readTasks(projectPath))[0]?.status, 'in-progress');
    const workflow = JSON.parse(
      await readFile(path.join(projectPath, '.taskmaster', 'cloudcli-workflow.json'), 'utf8'),
    ) as { tasks: Record<string, { implementationSessionId?: string }> };
    assert.equal(workflow.tasks['1']?.implementationSessionId, 'fresh-implementation');
    const summary = await taskmasterWorkflowService.getTaskWorkflowSummary(projectPath) as Record<
      string,
      { implementationSessionId?: string }
    >;
    assert.equal(summary['1']?.implementationSessionId, 'fresh-implementation');
    assert.doesNotThrow(() => taskmasterWorkflowService.assertStatusChangeAllowed({
      projectPath,
      taskId: '1',
      status: 'in-progress',
    }));
  });
});
