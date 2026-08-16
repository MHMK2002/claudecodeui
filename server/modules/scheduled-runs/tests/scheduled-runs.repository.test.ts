import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('repository persists project/profile identity and atomically rejects duplicate execution', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'scheduled-runs-repository-'));
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');
  const database = await import('@/modules/database/index.js');
  database.closeConnection();

  try {
    await database.initializeDatabase();
    const user = database.userDb.createUser(`schedule-repository-${Date.now()}`, 'unused-password-hash');
    const projectPath = path.join(temporaryDirectory, 'project');
    await mkdir(projectPath);
    const project = database.projectsDb.createProjectPath(projectPath).project;
    assert.ok(project);
    const created = database.scheduledRunsRepository.create(Number(user.id), {
      title: 'Daily review',
      projectId: project.project_id,
      projectPath: project.project_path,
      provider: 'cursor',
      providerProfileId: null,
      model: 'cursor-fast',
      prompt: 'Review the project',
      cronExpression: '0 8 * * *',
      timezone: 'UTC',
      notifyOnSuccess: false,
      notifyOnFailure: true,
      isEnabled: true,
      nextRunAt: '2026-08-17 08:00:00',
    });
    assert.equal(created.projectId, project.project_id);
    assert.equal(created.providerProfileId, null);

    const firstClaim = database.scheduledRunsRepository.claimNextRun(created.id, 'manual');
    assert.ok(firstClaim);
    assert.equal(database.scheduledRunsRepository.claimNextRun(created.id, 'manual'), null);
    database.scheduledRunsRepository.finishRun(
      firstClaim.run.id,
      'missed',
      null,
      'Desktop was inactive.',
      '2026-08-18 08:00:00',
      false,
    );
    const [history] = database.scheduledRunsRepository.listHistory(created.id, 5);
    assert.equal(history.status, 'missed');
    assert.equal(history.errorMessage, 'Desktop was inactive.');
  } finally {
    database.closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
