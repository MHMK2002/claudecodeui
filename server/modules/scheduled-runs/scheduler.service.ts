import fs from 'node:fs';

import {
  projectsDb,
  providerProfilesDb,
  scheduledRunsRepository,
} from '@/modules/database/index.js';
import {
  notifyScheduleRunFailed,
  notifyScheduleRunSucceeded,
} from '@/modules/notifications/index.js';
import {
  providerRuntimeService,
  providerSelectionService,
} from '@/modules/providers/index.js';
import {
  broadcastScheduledRunFinished,
  broadcastScheduledRunsChanged,
} from '@/modules/websocket/index.js';
import type {
  AnyRecord,
  ProviderProfileRuntime,
  ProviderRuntimeWriter,
  ScheduledRunClaim,
  ScheduledRunHistoryStatus,
  ScheduledRunRecord,
} from '@/shared/types.js';

import { nextRunAt } from './cron.js';

const TICK_INTERVAL_MS = 60_000;
const RUN_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_SUMMARY_CAP_BYTES = 16 * 1024;
const MISSED_MESSAGE = 'Desktop or the local server was not active at the scheduled time. This run was not replayed.';

type SchedulerLogger = Pick<Console, 'debug' | 'error' | 'info'>;
type SchedulerRepository = Pick<
  typeof scheduledRunsRepository,
  'listDue' | 'claimNextRun' | 'finishRun' | 'repairOrphanedRuns' | 'advanceNextRun' | 'getById'
>;

type SchedulerDependencies = {
  repository: SchedulerRepository;
  projects: Pick<typeof projectsDb, 'getProjectById' | 'getProjectPath'>;
  providerProfiles: Pick<typeof providerProfilesDb, 'getProviderProfileForRuntime'>;
  providerSelection: Pick<typeof providerSelectionService, 'validateSelection'>;
  runtime: Pick<typeof providerRuntimeService, 'run'>;
  pathExists(projectPath: string): boolean;
  broadcastChanged(userId: number): void;
  broadcastFinished(userId: number, payload: AnyRecord): void;
  notifySucceeded: typeof notifyScheduleRunSucceeded;
  notifyFailed: typeof notifyScheduleRunFailed;
  now(): Date;
  setInterval(handler: () => void, milliseconds: number): NodeJS.Timeout;
  clearInterval(handle: NodeJS.Timeout): void;
  logger: SchedulerLogger;
};

const defaultDependencies: SchedulerDependencies = {
  repository: scheduledRunsRepository,
  projects: projectsDb,
  providerProfiles: providerProfilesDb,
  providerSelection: providerSelectionService,
  runtime: providerRuntimeService,
  pathExists: fs.existsSync,
  broadcastChanged: broadcastScheduledRunsChanged,
  broadcastFinished: broadcastScheduledRunFinished,
  notifySucceeded: notifyScheduleRunSucceeded,
  notifyFailed: notifyScheduleRunFailed,
  now: () => new Date(),
  setInterval: (handler, milliseconds) => globalThis.setInterval(handler, milliseconds),
  clearInterval: (handle) => globalThis.clearInterval(handle),
  logger: console,
};

class SchedulerPrerequisiteError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'SchedulerPrerequisiteError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class CollectingWriter implements ProviderRuntimeWriter {
  userId: number;
  private sessionId: string | null = null;
  private readonly assistantTexts: string[] = [];

  constructor(userId: number) {
    this.userId = userId;
  }

  send(raw: unknown): void {
    let data: unknown = raw;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data) as unknown;
      } catch {
        return;
      }
    }
    if (!isRecord(data)) return;
    if (typeof data.sessionId === 'string') this.sessionId = data.sessionId;
    if (data.type === 'claude-response' && isRecord(data.data) && data.data.type === 'assistant') {
      const message = data.data.message;
      if (isRecord(message) && Array.isArray(message.content)) {
        for (const block of message.content) {
          if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
            this.assistantTexts.push(block.text);
          }
        }
      }
    }
    if (
      (data.type === 'codex-response' || data.type === 'cursor-response' || data.type === 'opencode-response')
      && isRecord(data.data)
    ) {
      if (typeof data.data.text === 'string') this.assistantTexts.push(data.data.text);
      else if (typeof data.data.content === 'string') this.assistantTexts.push(data.data.content);
    }
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  getOutputSummary(): string {
    const output = this.assistantTexts.join('\n\n').trim();
    if (output.length <= OUTPUT_SUMMARY_CAP_BYTES) return output;
    return `${output.slice(0, OUTPUT_SUMMARY_CAP_BYTES)}\n\n...(truncated)`;
  }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = globalThis.setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) globalThis.clearTimeout(timer);
  });
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : fallback;
}

/**
 * Creates the local-only scheduler used by the server composition root and
 * focused lifecycle tests. Startup records overdue times as Missed before the
 * recurring tick starts, so downtime never becomes an automatic replay.
 */
export function createSchedulerService(
  dependencyOverrides: Partial<SchedulerDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  let tickHandle: NodeJS.Timeout | null = null;
  let isTicking = false;
  const inFlightRuns = new Set<Promise<void>>();

  const computeNextRun = (schedule: ScheduledRunRecord): string | null => {
    try {
      return nextRunAt(schedule.cronExpression, schedule.timezone, dependencies.now())
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z$/, '');
    } catch (error) {
      dependencies.logger.error('[Scheduler] Failed to calculate the next run.', error);
      return null;
    }
  };

  const resolveRuntime = async (schedule: ScheduledRunRecord) => {
    const project = schedule.projectId
      ? dependencies.projects.getProjectById(schedule.projectId)
      : dependencies.projects.getProjectPath(schedule.projectPath);
    if (!project || project.isArchived || !dependencies.pathExists(project.project_path)) {
      throw new SchedulerPrerequisiteError(
        'The scheduled project was moved, deleted, or is unavailable.',
        'PROJECT_UNAVAILABLE',
      );
    }
    try {
      await dependencies.providerSelection.validateSelection({
        userId: schedule.userId,
        provider: schedule.provider,
        providerProfileId: schedule.providerProfileId,
        model: schedule.model,
      });
    } catch (error) {
      throw new SchedulerPrerequisiteError(
        error instanceof Error ? error.message : 'The scheduled provider is unavailable.',
        errorCode(error, 'PROVIDER_UNAVAILABLE'),
      );
    }
    let providerProfile: ProviderProfileRuntime | null = null;
    if (schedule.providerProfileId !== null && (schedule.provider === 'claude' || schedule.provider === 'codex')) {
      providerProfile = dependencies.providerProfiles.getProviderProfileForRuntime(
        schedule.userId,
        schedule.provider,
        schedule.providerProfileId,
      );
      if (!providerProfile) {
        throw new SchedulerPrerequisiteError('The scheduled provider profile is unavailable.', 'PROVIDER_PROFILE_NOT_FOUND');
      }
    }
    return { projectPath: project.project_path, providerProfile };
  };

  const finishRun = (
    claim: ScheduledRunClaim,
    status: ScheduledRunHistoryStatus,
    output: string | null,
    failure: string | null,
    notificationDispatched: boolean,
  ) => {
    dependencies.repository.finishRun(
      claim.run.id,
      status,
      output,
      failure,
      computeNextRun(claim.schedule),
      notificationDispatched,
    );
    dependencies.broadcastFinished(claim.schedule.userId, {
      scheduleId: claim.schedule.id,
      runId: claim.run.id,
      status,
      ...(output ? { summary: output.slice(0, 240) } : {}),
      ...(failure ? { errorMessage: failure } : {}),
    });
    dependencies.broadcastChanged(claim.schedule.userId);
  };

  const executeRun = async (claim: ScheduledRunClaim): Promise<void> => {
    let resolved: Awaited<ReturnType<typeof resolveRuntime>>;
    try {
      resolved = await resolveRuntime(claim.schedule);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishRun(claim, 'skipped', null, message, false);
      return;
    }

    const writer = new CollectingWriter(claim.schedule.userId);
    const options: AnyRecord = {
      projectPath: resolved.projectPath,
      cwd: resolved.projectPath,
      sessionId: null,
      model: claim.schedule.model,
      permissionMode: 'bypassPermissions',
      skipPermissions: true,
      claudeProviderProfile: claim.schedule.provider === 'claude' ? resolved.providerProfile ?? undefined : undefined,
      codexProviderProfile: claim.schedule.provider === 'codex' ? resolved.providerProfile ?? undefined : undefined,
    };
    const startedAt = dependencies.now().getTime();
    try {
      await withTimeout(
        dependencies.runtime.run(claim.schedule.provider, claim.schedule.prompt, options, writer),
        RUN_TIMEOUT_MS,
        `Timed out after ${RUN_TIMEOUT_MS / 60_000} minutes.`,
      );
      const output = writer.getOutputSummary() || '(no output captured)';
      let notificationDispatched = false;
      if (claim.schedule.notifyOnSuccess) {
        try {
          dependencies.notifySucceeded({
            schedule: claim.schedule,
            run: { ...claim.run, durationMs: Math.max(0, dependencies.now().getTime() - startedAt) },
            summary: output,
          });
          notificationDispatched = true;
        } catch (error) {
          dependencies.logger.error('[Scheduler] Success notification failed.', error);
        }
      }
      finishRun(claim, 'succeeded', output, null, notificationDispatched);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let notificationDispatched = false;
      if (claim.schedule.notifyOnFailure) {
        try {
          dependencies.notifyFailed({ schedule: claim.schedule, run: claim.run, errorMessage: message });
          notificationDispatched = true;
        } catch (notificationError) {
          dependencies.logger.error('[Scheduler] Failure notification failed.', notificationError);
        }
      }
      finishRun(claim, 'failed', null, message, notificationDispatched);
    }
  };

  const trackRun = (claim: ScheduledRunClaim) => {
    const task = executeRun(claim);
    inFlightRuns.add(task);
    void task.finally(() => inFlightRuns.delete(task));
  };

  const tick = async () => {
    if (isTicking) {
      dependencies.logger.debug('[Scheduler] Previous tick is still active; skipping duplicate tick.');
      return;
    }
    isTicking = true;
    try {
      for (const schedule of dependencies.repository.listDue(dependencies.now())) {
        const claim = dependencies.repository.claimNextRun(schedule.id, 'tick');
        if (claim) trackRun(claim);
      }
    } catch (error) {
      dependencies.logger.error('[Scheduler] Tick failed.', error);
    } finally {
      isTicking = false;
    }
  };

  const markStartupMisses = (overdueSchedules: ScheduledRunRecord[]) => {
    for (const schedule of overdueSchedules) {
      const claim = dependencies.repository.claimNextRun(schedule.id, 'tick');
      if (!claim) continue;
      finishRun(claim, 'missed', null, MISSED_MESSAGE, false);
    }
  };

  return {
    async start(): Promise<void> {
      if (tickHandle) return;
      const overdueSchedules = dependencies.repository.listDue(dependencies.now());
      const interruptedDueSchedules = overdueSchedules.filter((schedule) => schedule.inFlightRunId !== null);
      const repaired = dependencies.repository.repairOrphanedRuns();
      if (repaired > 0) dependencies.logger.info(`[Scheduler] Repaired ${repaired} interrupted run(s).`);
      for (const schedule of interruptedDueSchedules) {
        const nextRunAtValue = computeNextRun(schedule);
        if (nextRunAtValue) dependencies.repository.advanceNextRun(schedule.id, nextRunAtValue);
      }
      markStartupMisses(overdueSchedules.filter((schedule) => schedule.inFlightRunId === null));
      tickHandle = dependencies.setInterval(() => {
        void tick();
      }, TICK_INTERVAL_MS);
      dependencies.logger.info('[Scheduler] Started; overdue downtime runs were marked Missed without replay.');
    },

    async stop(): Promise<void> {
      if (tickHandle) {
        dependencies.clearInterval(tickHandle);
        tickHandle = null;
      }
      if (inFlightRuns.size > 0) await Promise.allSettled([...inFlightRuns]);
      dependencies.logger.info('[Scheduler] Stopped.');
    },

    async triggerManualRun(userId: number, scheduleId: number) {
      const schedule = dependencies.repository.getById(userId, scheduleId);
      if (!schedule) return { error: 'Schedule not found.', code: 'SCHEDULE_NOT_FOUND' } as const;
      try {
        await resolveRuntime(schedule);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          code: errorCode(error, 'SCHEDULE_PREREQUISITE_UNAVAILABLE'),
        } as const;
      }
      const claim = dependencies.repository.claimNextRun(scheduleId, 'manual');
      if (!claim) return { error: 'A run is already in progress for this schedule.', code: 'RUN_ALREADY_ACTIVE' } as const;
      trackRun(claim);
      return { runId: claim.run.id } as const;
    },
  };
}

const schedulerService = createSchedulerService();

/** Used by the server entrypoint to start the local scheduler loop. */
export async function startScheduler(): Promise<void> {
  await schedulerService.start();
}

/** Used by graceful shutdown to stop ticks and drain active scheduled runs. */
export async function stopScheduler(): Promise<void> {
  await schedulerService.stop();
}

/** Used by the Schedules application service for the secondary Run now action. */
export async function triggerManualRun(userId: number, scheduleId: number) {
  return schedulerService.triggerManualRun(userId, scheduleId);
}
