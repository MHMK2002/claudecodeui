import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ScheduledRunClaim,
  ScheduledRunHistoryRecord,
  ScheduledRunHistoryStatus,
  ScheduledRunRecord,
} from '@/shared/types.js';

import { createSchedulerService } from '../scheduler.service.js';

const now = new Date('2026-08-16T10:00:00.000Z');

function schedule(overrides: Partial<ScheduledRunRecord> = {}): ScheduledRunRecord {
  return {
    id: 11,
    userId: 7,
    title: 'Daily review',
    projectId: 'project-1',
    projectPath: '/old/project',
    provider: 'cursor',
    providerProfileId: null,
    model: 'cursor-fast',
    prompt: 'Review the project',
    cronExpression: '0 8 * * *',
    timezone: 'UTC',
    notifyOnSuccess: false,
    notifyOnFailure: false,
    notifyChannels: null,
    isEnabled: true,
    lastRunAt: null,
    nextRunAt: '2026-08-16T08:00:00.000Z',
    inFlightRunId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function claim(target = schedule()): ScheduledRunClaim {
  const run: ScheduledRunHistoryRecord = {
    id: 91,
    scheduleId: target.id,
    userId: target.userId,
    status: 'running',
    trigger: 'tick',
    startedAt: now.toISOString(),
    finishedAt: null,
    durationMs: null,
    outputSummary: null,
    errorMessage: null,
    notificationDispatched: false,
  };
  return { schedule: target, run };
}

function dependencies(options: {
  due?: ScheduledRunRecord[] | (() => ScheduledRunRecord[]);
  claim?: (scheduleId: number) => ScheduledRunClaim | null;
  project?: { project_id: string; project_path: string; custom_project_name: null; isStarred: number; isArchived: number } | null;
  validate?: () => Promise<void>;
  runtime?: (options: Record<string, unknown>) => Promise<void>;
  repairCount?: number;
} = {}) {
  const finished: Array<{ status: ScheduledRunHistoryStatus; error: string | null; nextRunAt: string | null }> = [];
  const advanced: Array<{ scheduleId: number; nextRunAt: string }> = [];
  let intervalHandler: (() => void) | null = null;
  let claimCount = 0;
  const target = schedule();
  return {
    finished,
    advanced,
    getClaimCount: () => claimCount,
    runInterval: () => intervalHandler?.(),
    overrides: {
      repository: {
        listDue: () => typeof options.due === 'function' ? options.due() : options.due ?? [],
        claimNextRun: (scheduleId: number) => {
          claimCount += 1;
          return options.claim ? options.claim(scheduleId) : claim(target);
        },
        finishRun: (
          _runId: number,
          status: ScheduledRunHistoryStatus,
          _output: string | null,
          error: string | null,
          nextRunAt: string | null,
        ) => {
          finished.push({ status, error, nextRunAt });
          return null;
        },
        repairOrphanedRuns: () => options.repairCount ?? 0,
        advanceNextRun: (scheduleId: number, nextRunAt: string) => { advanced.push({ scheduleId, nextRunAt }); },
        getById: (_userId: number, id: number) => id === target.id ? target : null,
      },
      projects: {
        getProjectById: () => options.project === undefined
          ? { project_id: 'project-1', project_path: '/moved/project', custom_project_name: null, isStarred: 0, isArchived: 0 }
          : options.project,
        getProjectPath: () => options.project === undefined
          ? { project_id: 'project-1', project_path: '/moved/project', custom_project_name: null, isStarred: 0, isArchived: 0 }
          : options.project,
      },
      providerProfiles: { getProviderProfileForRuntime: () => null },
      providerSelection: { validateSelection: options.validate ?? (async () => undefined) },
      runtime: {
        run: async (_provider: string, _prompt: string, runtimeOptions: Record<string, unknown>) => {
          await options.runtime?.(runtimeOptions);
        },
      },
      pathExists: () => true,
      broadcastChanged: () => undefined,
      broadcastFinished: () => undefined,
      notifySucceeded: () => undefined,
      notifyFailed: () => undefined,
      now: () => now,
      setInterval: (handler: () => void) => {
        intervalHandler = handler;
        return {} as NodeJS.Timeout;
      },
      clearInterval: () => {
        intervalHandler = null;
      },
      logger: { debug: () => undefined, error: () => undefined, info: () => undefined },
    },
  };
}

test('startup repairs interrupted runs and marks overdue runs Missed without provider replay', async () => {
  const target = schedule();
  let runtimeCalls = 0;
  const fixture = dependencies({
    due: [target],
    repairCount: 1,
    runtime: async () => { runtimeCalls += 1; },
  });
  const scheduler = createSchedulerService(fixture.overrides);
  await scheduler.start();
  await scheduler.stop();
  assert.equal(runtimeCalls, 0);
  assert.equal(fixture.finished.length, 1);
  assert.equal(fixture.finished[0].status, 'missed');
  assert.match(fixture.finished[0].error ?? '', /not replayed/i);
  assert.ok(new Date(fixture.finished[0].nextRunAt ?? '').getTime() > now.getTime());
});

test('a moved project resolves by stable project id while a deleted project is rejected', async () => {
  let cwd: unknown;
  const moved = dependencies({ runtime: async (options) => { cwd = options.cwd; } });
  const movedScheduler = createSchedulerService(moved.overrides);
  assert.deepEqual(await movedScheduler.triggerManualRun(7, 11), { runId: 91 });
  await movedScheduler.stop();
  assert.equal(cwd, '/moved/project');

  const deleted = dependencies({ project: null });
  const deletedScheduler = createSchedulerService(deleted.overrides);
  const result = await deletedScheduler.triggerManualRun(7, 11);
  assert.deepEqual(result, {
    error: 'The scheduled project was moved, deleted, or is unavailable.',
    code: 'PROJECT_UNAVAILABLE',
  });
  assert.equal(deleted.getClaimCount(), 0);
});

test('restart advances an interrupted due slot without replay or duplicate Missed history', async () => {
  const interrupted = schedule({ inFlightRunId: 91 });
  let runtimeCalls = 0;
  const fixture = dependencies({
    due: [interrupted],
    repairCount: 1,
    runtime: async () => { runtimeCalls += 1; },
  });
  const scheduler = createSchedulerService(fixture.overrides);
  await scheduler.start();
  await scheduler.stop();
  assert.equal(runtimeCalls, 0);
  assert.deepEqual(fixture.finished, []);
  assert.equal(fixture.advanced.length, 1);
  assert.equal(fixture.advanced[0].scheduleId, interrupted.id);
  assert.ok(new Date(fixture.advanced[0].nextRunAt).getTime() > now.getTime());
});

test('provider logout skips a tick and returns explicit recovery for Run now', async () => {
  let dueCalls = 0;
  const fixture = dependencies({
    due: () => (++dueCalls === 1 ? [] : [schedule()]),
    validate: async () => {
      const error = new Error('Provider is not connected.') as Error & { code: string };
      error.code = 'PROVIDER_NOT_CONNECTED';
      throw error;
    },
  });
  const scheduler = createSchedulerService(fixture.overrides);
  await scheduler.start();
  fixture.runInterval();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await scheduler.stop();
  assert.equal(fixture.finished[0]?.status, 'skipped');
  assert.match(fixture.finished[0]?.error ?? '', /not connected/i);

  const manual = await scheduler.triggerManualRun(7, 11);
  assert.deepEqual(manual, { error: 'Provider is not connected.', code: 'PROVIDER_NOT_CONNECTED' });
});

test('atomic claim prevents duplicate manual execution while one run is active', async () => {
  let releaseRuntime!: () => void;
  const runtimeCompletion = new Promise<void>((resolve) => { releaseRuntime = resolve; });
  let claims = 0;
  const targetClaim = claim();
  const fixture = dependencies({
    claim: () => (++claims === 1 ? targetClaim : null),
    runtime: () => runtimeCompletion,
  });
  const scheduler = createSchedulerService(fixture.overrides);
  assert.deepEqual(await scheduler.triggerManualRun(7, 11), { runId: 91 });
  assert.deepEqual(await scheduler.triggerManualRun(7, 11), {
    error: 'A run is already in progress for this schedule.',
    code: 'RUN_ALREADY_ACTIVE',
  });
  assert.equal(claims, 2);
  releaseRuntime();
  await scheduler.stop();
  assert.equal(fixture.finished.filter((entry) => entry.status === 'succeeded').length, 1);
});
