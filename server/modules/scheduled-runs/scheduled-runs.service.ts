import { projectsDb, scheduledRunsRepository } from '@/modules/database/index.js';
import { providerSelectionService } from '@/modules/providers/index.js';
import { broadcastScheduledRunsChanged } from '@/modules/websocket/index.js';
import type {
  ProjectRepositoryRow,
  ScheduledRunMutationInput,
  ScheduledRunMutationPatch,
  ScheduledRunRecord,
} from '@/shared/types.js';

import { nextRunAt } from './cron.js';
import { triggerManualRun } from './scheduler.service.js';

type SchedulesRepository = Pick<
  typeof scheduledRunsRepository,
  'list' | 'getById' | 'create' | 'update' | 'delete' | 'setEnabled' | 'listHistory'
>;

type ScheduledRunsServiceDependencies = {
  repository: SchedulesRepository;
  projects: Pick<typeof projectsDb, 'getProjectById' | 'getProjectPath'>;
  providerSelection: Pick<typeof providerSelectionService, 'validateSelection'>;
  broadcastChanged(userId: number): void;
  triggerRun(userId: number, scheduleId: number): ReturnType<typeof triggerManualRun>;
  now(): Date;
};

const defaultDependencies: ScheduledRunsServiceDependencies = {
  repository: scheduledRunsRepository,
  projects: projectsDb,
  providerSelection: providerSelectionService,
  broadcastChanged: broadcastScheduledRunsChanged,
  triggerRun: triggerManualRun,
  now: () => new Date(),
};

/** Expected Schedules failure translated to an HTTP response by the router. */
export class ScheduledRunsServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'ScheduledRunsServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function dbDate(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function requireSchedule(
  repository: SchedulesRepository,
  userId: number,
  scheduleId: number,
): ScheduledRunRecord {
  const schedule = repository.getById(userId, scheduleId);
  if (!schedule) throw new ScheduledRunsServiceError('Schedule not found.', 'SCHEDULE_NOT_FOUND', 404);
  return schedule;
}

function resolveProject(
  projects: ScheduledRunsServiceDependencies['projects'],
  projectId: string | null,
  legacyProjectPath?: string,
): ProjectRepositoryRow {
  const project = projectId
    ? projects.getProjectById(projectId)
    : legacyProjectPath ? projects.getProjectPath(legacyProjectPath) : null;
  if (!project || project.isArchived) {
    throw new ScheduledRunsServiceError(
      'The selected project is unavailable. Choose an active local project.',
      'PROJECT_UNAVAILABLE',
      409,
    );
  }
  return project;
}

/**
 * Creates the Schedules application service used by HTTP routes and focused
 * lifecycle tests. It owns project resolution, provider selection validation,
 * next-run calculation, persistence orchestration, and change broadcasts.
 */
export function createScheduledRunsService(
  dependencyOverrides: Partial<ScheduledRunsServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  const validateSelection = async (
    userId: number,
    input: Pick<ScheduledRunMutationInput, 'provider' | 'providerProfileId' | 'model'>,
  ) => {
    try {
      await dependencies.providerSelection.validateSelection({
        userId,
        provider: input.provider,
        providerProfileId: input.providerProfileId,
        model: input.model,
      });
    } catch (error) {
      const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'PROVIDER_SELECTION_INVALID';
      const statusCode = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 409;
      throw new ScheduledRunsServiceError(
        error instanceof Error ? error.message : 'Provider selection is unavailable.',
        code,
        statusCode,
      );
    }
  };

  return {
    list(userId: number): ScheduledRunRecord[] {
      return dependencies.repository.list(userId);
    },

    get(userId: number, scheduleId: number): ScheduledRunRecord {
      return requireSchedule(dependencies.repository, userId, scheduleId);
    },

    async create(userId: number, input: ScheduledRunMutationInput): Promise<ScheduledRunRecord> {
      const project = resolveProject(dependencies.projects, input.projectId);
      await validateSelection(userId, input);
      let nextRun: Date;
      try {
        nextRun = nextRunAt(input.cronExpression, input.timezone, dependencies.now());
      } catch (error) {
        throw new ScheduledRunsServiceError(
          error instanceof Error ? error.message : 'Schedule timing is invalid.',
          'SCHEDULE_TIMING_INVALID',
          400,
        );
      }
      const schedule = dependencies.repository.create(userId, {
        ...input,
        title: input.title.trim(),
        prompt: input.prompt.trim(),
        cronExpression: input.cronExpression.trim(),
        projectId: project.project_id,
        projectPath: project.project_path,
        nextRunAt: dbDate(nextRun),
      });
      dependencies.broadcastChanged(userId);
      return schedule;
    },

    async update(
      userId: number,
      scheduleId: number,
      patch: ScheduledRunMutationPatch,
    ): Promise<ScheduledRunRecord> {
      const existing = requireSchedule(dependencies.repository, userId, scheduleId);
      const project = resolveProject(
        dependencies.projects,
        patch.projectId ?? existing.projectId,
        existing.projectPath,
      );
      const selection = {
        provider: patch.provider ?? existing.provider,
        providerProfileId: patch.providerProfileId === undefined
          ? existing.providerProfileId
          : patch.providerProfileId,
        model: patch.model ?? existing.model,
      };
      await validateSelection(userId, selection);
      const cronExpression = patch.cronExpression ?? existing.cronExpression;
      const timezone = patch.timezone ?? existing.timezone;
      const timingChanged = cronExpression !== existing.cronExpression || timezone !== existing.timezone;
      let nextRunAtValue = existing.nextRunAt;
      if (timingChanged) {
        try {
          nextRunAtValue = dbDate(nextRunAt(cronExpression, timezone, dependencies.now()));
        } catch (error) {
          throw new ScheduledRunsServiceError(
            error instanceof Error ? error.message : 'Schedule timing is invalid.',
            'SCHEDULE_TIMING_INVALID',
            400,
          );
        }
      }
      const updated = dependencies.repository.update(userId, scheduleId, {
        ...patch,
        ...selection,
        projectId: project.project_id,
        projectPath: project.project_path,
        cronExpression,
        timezone,
        nextRunAt: nextRunAtValue,
      });
      if (!updated) throw new ScheduledRunsServiceError('Schedule not found.', 'SCHEDULE_NOT_FOUND', 404);
      dependencies.broadcastChanged(userId);
      return updated;
    },

    remove(userId: number, scheduleId: number): void {
      if (!dependencies.repository.delete(userId, scheduleId)) {
        throw new ScheduledRunsServiceError('Schedule not found.', 'SCHEDULE_NOT_FOUND', 404);
      }
      dependencies.broadcastChanged(userId);
    },

    async setEnabled(userId: number, scheduleId: number, enabled: boolean): Promise<ScheduledRunRecord> {
      const existing = requireSchedule(dependencies.repository, userId, scheduleId);
      if (enabled) {
        resolveProject(dependencies.projects, existing.projectId, existing.projectPath);
        await validateSelection(userId, existing);
      }
      const updated = dependencies.repository.setEnabled(userId, scheduleId, enabled);
      if (!updated) throw new ScheduledRunsServiceError('Schedule not found.', 'SCHEDULE_NOT_FOUND', 404);
      dependencies.broadcastChanged(userId);
      return updated;
    },

    history(userId: number, scheduleId: number, limit: number) {
      requireSchedule(dependencies.repository, userId, scheduleId);
      return dependencies.repository.listHistory(scheduleId, limit);
    },

    async runNow(userId: number, scheduleId: number): Promise<{ runId: number }> {
      requireSchedule(dependencies.repository, userId, scheduleId);
      const result = await dependencies.triggerRun(userId, scheduleId);
      if ('error' in result && typeof result.error === 'string') {
        throw new ScheduledRunsServiceError(
          result.error,
          typeof result.code === 'string' ? result.code : 'SCHEDULE_RUN_REJECTED',
          result.code === 'SCHEDULE_NOT_FOUND' ? 404 : 409,
        );
      }
      if ('runId' in result && typeof result.runId === 'number') return { runId: result.runId };
      throw new ScheduledRunsServiceError('Scheduled run did not start.', 'SCHEDULE_RUN_REJECTED', 409);
    },
  };
}

/** Production Schedules service consumed by the module's thin HTTP router. */
export const scheduledRunsService = createScheduledRunsService();
