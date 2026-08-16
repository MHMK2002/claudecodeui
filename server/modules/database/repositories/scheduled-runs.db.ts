/**
 * Scheduled runs repository.
 *
 * Stores user-defined recurring AI agent jobs and their per-execution history.
 * The `claimNextRun` helper is the atomic-claim primitive that the scheduler
 * service uses to ensure only one run fires per schedule at a time — it
 * wraps a single transaction so a tick and a manual Run-Now cannot both
 * succeed for the same schedule.
 */

import { getConnection } from '@/modules/database/connection.js';
import type {
  LLMProvider,
  ScheduledRunClaim,
  ScheduledRunHistoryRecord,
  ScheduledRunHistoryStatus,
  ScheduledRunPersistenceCreateInput,
  ScheduledRunPersistenceUpdateInput,
  ScheduledRunRecord,
  ScheduledRunTrigger,
} from '@/shared/types.js';

// ---------------------------------------------------------------------------
// Row shape (snake_case SQL columns)
// ---------------------------------------------------------------------------

interface ScheduledRunRow {
  id: number;
  user_id: number;
  title: string;
  project_id: string | null;
  project_path: string;
  provider: string;
  provider_profile_id: number | null;
  model: string;
  prompt: string;
  cron_expression: string;
  timezone: string;
  notify_on_success: number;
  notify_on_failure: number;
  notify_channels_json: string | null;
  is_enabled: number;
  last_run_at: string | null;
  next_run_at: string;
  in_flight_run_id: number | null;
  created_at: string;
  updated_at: string;
}

interface HistoryRow {
  id: number;
  schedule_id: number;
  user_id: number;
  status: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  output_summary: string | null;
  error_message: string | null;
  notification_dispatched: number;
}

const SCHEDULED_ROW_COLUMNS =
  'id, user_id, title, project_id, project_path, provider, provider_profile_id, model, prompt, cron_expression, timezone, ' +
  'notify_on_success, notify_on_failure, notify_channels_json, is_enabled, last_run_at, ' +
  'next_run_at, in_flight_run_id, created_at, updated_at';

function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  // SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" in UTC. Parse and emit ISO 8601 so
  // the frontend's Date constructor does not interpret it as local time.
  const isoSpace = value.replace(' ', 'T') + 'Z';
  const parsed = new Date(isoSpace);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function normalizeSchedule(row: ScheduledRunRow): ScheduledRunRecord {
  let notifyChannels: string[] | null = null;
  if (row.notify_channels_json) {
    try {
      const parsed = JSON.parse(row.notify_channels_json);
      if (Array.isArray(parsed)) notifyChannels = parsed as string[];
    } catch {
      notifyChannels = null;
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    projectId: row.project_id,
    projectPath: row.project_path,
    provider: row.provider as LLMProvider,
    providerProfileId: row.provider_profile_id,
    model: row.model,
    prompt: row.prompt,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    notifyOnSuccess: Boolean(row.notify_on_success),
    notifyOnFailure: Boolean(row.notify_on_failure),
    notifyChannels,
    isEnabled: Boolean(row.is_enabled),
    lastRunAt: toIsoDate(row.last_run_at),
    nextRunAt: toIsoDate(row.next_run_at) ?? row.next_run_at,
    inFlightRunId: row.in_flight_run_id,
    createdAt: toIsoDate(row.created_at) ?? row.created_at,
    updatedAt: toIsoDate(row.updated_at) ?? row.updated_at,
  };
}

function normalizeHistory(row: HistoryRow): ScheduledRunHistoryRecord {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    userId: row.user_id,
    status: row.status as ScheduledRunHistoryStatus,
    trigger: row.trigger as ScheduledRunTrigger,
    startedAt: toIsoDate(row.started_at) ?? row.started_at,
    finishedAt: toIsoDate(row.finished_at),
    durationMs: row.duration_ms,
    outputSummary: row.output_summary,
    errorMessage: row.error_message,
    notificationDispatched: Boolean(row.notification_dispatched),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const scheduledRunsRepository = {
  list(userId: number): ScheduledRunRecord[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SCHEDULED_ROW_COLUMNS}
         FROM scheduled_runs
         WHERE user_id = ?
         ORDER BY is_enabled DESC, next_run_at ASC`,
      )
      .all(userId) as ScheduledRunRow[];
    return rows.map(normalizeSchedule);
  },

  listAll(): ScheduledRunRecord[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SCHEDULED_ROW_COLUMNS}
         FROM scheduled_runs
         ORDER BY next_run_at ASC`,
      )
      .all() as ScheduledRunRow[];
    return rows.map(normalizeSchedule);
  },

  getById(userId: number, id: number): ScheduledRunRecord | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SCHEDULED_ROW_COLUMNS}
         FROM scheduled_runs
         WHERE user_id = ? AND id = ?
         LIMIT 1`,
      )
      .get(userId, id) as ScheduledRunRow | undefined;
    return row ? normalizeSchedule(row) : null;
  },

  getByIdInternal(id: number): ScheduledRunRecord | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SCHEDULED_ROW_COLUMNS}
         FROM scheduled_runs
         WHERE id = ?
         LIMIT 1`,
      )
      .get(id) as ScheduledRunRow | undefined;
    return row ? normalizeSchedule(row) : null;
  },

  create(userId: number, input: ScheduledRunPersistenceCreateInput): ScheduledRunRecord {
    const db = getConnection();
    const notifyChannelsJson = input.notifyChannels
      ? JSON.stringify(input.notifyChannels)
      : null;
    const result = db
      .prepare(
        `INSERT INTO scheduled_runs (
           user_id, title, project_id, project_path, provider, provider_profile_id, model, prompt, cron_expression, timezone,
           notify_on_success, notify_on_failure, notify_channels_json, is_enabled,
           next_run_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        input.title,
        input.projectId,
        input.projectPath,
        input.provider,
        input.providerProfileId,
        input.model,
        input.prompt,
        input.cronExpression,
        input.timezone,
        input.notifyOnSuccess ? 1 : 0,
        input.notifyOnFailure ? 1 : 0,
        notifyChannelsJson,
        input.isEnabled ? 1 : 0,
        input.nextRunAt,
      );
    const created = this.getById(userId, Number(result.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to load newly created scheduled run.');
    }
    return created;
  },

  update(userId: number, id: number, patch: ScheduledRunPersistenceUpdateInput): ScheduledRunRecord | null {
    const db = getConnection();
    const existing = this.getById(userId, id);
    if (!existing) return null;

    const next: ScheduledRunPersistenceCreateInput = {
      title: patch.title ?? existing.title,
      projectId: patch.projectId ?? existing.projectId ?? '',
      projectPath: patch.projectPath ?? existing.projectPath,
      provider: patch.provider ?? existing.provider,
      providerProfileId: patch.providerProfileId === undefined
        ? existing.providerProfileId
        : patch.providerProfileId,
      model: patch.model ?? existing.model,
      prompt: patch.prompt ?? existing.prompt,
      cronExpression: patch.cronExpression ?? existing.cronExpression,
      timezone: patch.timezone ?? existing.timezone,
      notifyOnSuccess: patch.notifyOnSuccess ?? existing.notifyOnSuccess,
      notifyOnFailure: patch.notifyOnFailure ?? existing.notifyOnFailure,
      notifyChannels:
        patch.notifyChannels === undefined ? existing.notifyChannels : patch.notifyChannels,
      isEnabled: patch.isEnabled ?? existing.isEnabled,
      nextRunAt: patch.nextRunAt ?? existing.nextRunAt,
    };

    const notifyChannelsJson = next.notifyChannels
      ? JSON.stringify(next.notifyChannels)
      : null;

    db.prepare(
      `UPDATE scheduled_runs SET
         title = ?, project_id = ?, project_path = ?, provider = ?, provider_profile_id = ?, model = ?, prompt = ?,
         cron_expression = ?, timezone = ?, notify_on_success = ?, notify_on_failure = ?,
         notify_channels_json = ?, is_enabled = ?, next_run_at = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND id = ?`,
    ).run(
      next.title,
      next.projectId,
      next.projectPath,
      next.provider,
      next.providerProfileId,
      next.model,
      next.prompt,
      next.cronExpression,
      next.timezone,
      next.notifyOnSuccess ? 1 : 0,
      next.notifyOnFailure ? 1 : 0,
      notifyChannelsJson,
      next.isEnabled ? 1 : 0,
      next.nextRunAt,
      userId,
      id,
    );

    return this.getById(userId, id);
  },

  delete(userId: number, id: number): boolean {
    const db = getConnection();
    const result = db
      .prepare('DELETE FROM scheduled_runs WHERE user_id = ? AND id = ?')
      .run(userId, id);
    return result.changes > 0;
  },

  setEnabled(userId: number, id: number, enabled: boolean): ScheduledRunRecord | null {
    const db = getConnection();
    db.prepare(
      `UPDATE scheduled_runs SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND id = ?`,
    ).run(enabled ? 1 : 0, userId, id);
    return this.getById(userId, id);
  },

  // -------------------------------------------------------------------------
  // Scheduler-internal methods
  // -------------------------------------------------------------------------

  listDue(now: Date): ScheduledRunRecord[] {
    const db = getConnection();
    const nowIso = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    const rows = db
      .prepare(
        `SELECT ${SCHEDULED_ROW_COLUMNS}
         FROM scheduled_runs
         WHERE is_enabled = 1 AND next_run_at <= ?
         ORDER BY next_run_at ASC`,
      )
      .all(nowIso) as ScheduledRunRow[];
    return rows.map(normalizeSchedule);
  },

  /** Advances an interrupted due slot after restart without creating a second history row. */
  advanceNextRun(scheduleId: number, nextRunAt: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE scheduled_runs
       SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(nextRunAt, scheduleId);
  },

  /**
   * Atomically claims the next run slot for a schedule.
   *
   * Returns `{ run, schedule }` on success, or `null` if a run is already in
   * flight (`in_flight_run_id` is non-null). The whole check-insert-update
   * sequence runs inside a single transaction so a tick and a manual Run-Now
   * invoked in the same window cannot both win.
   */
  claimNextRun(
    scheduleId: number,
    trigger: ScheduledRunTrigger = 'tick',
  ): ScheduledRunClaim | null {
    const db = getConnection();

    const claim = db.transaction(() => {
      const scheduleRow = db
        .prepare(
          `SELECT ${SCHEDULED_ROW_COLUMNS}
           FROM scheduled_runs
           WHERE id = ?
           LIMIT 1`,
        )
        .get(scheduleId) as ScheduledRunRow | undefined;

      if (!scheduleRow) return null;
      if (scheduleRow.in_flight_run_id !== null) return null;

      const insertInfo = db
        .prepare(
          `INSERT INTO scheduled_run_history (schedule_id, user_id, status, trigger)
           VALUES (?, ?, 'running', ?)`,
        )
        .run(scheduleRow.id, scheduleRow.user_id, trigger);

      const runId = Number(insertInfo.lastInsertRowid);

      db.prepare(
        `UPDATE scheduled_runs SET
           in_flight_run_id = ?,
           last_run_at = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND in_flight_run_id IS NULL`,
      ).run(runId, new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''), scheduleId);

      const freshScheduleRow = db
        .prepare(
          `SELECT ${SCHEDULED_ROW_COLUMNS}
           FROM scheduled_runs
           WHERE id = ?
           LIMIT 1`,
        )
        .get(scheduleId) as ScheduledRunRow | undefined;

      const runRow = db
        .prepare(
          `SELECT id, schedule_id, user_id, status, trigger, started_at, finished_at,
                  duration_ms, output_summary, error_message, notification_dispatched
           FROM scheduled_run_history
           WHERE id = ?`,
        )
        .get(runId) as HistoryRow | undefined;

      if (!freshScheduleRow || !runRow) return null;

      return {
        run: normalizeHistory(runRow),
        schedule: normalizeSchedule(freshScheduleRow),
      };
    });

    return claim();
  },

  finishRun(
    runId: number,
    status: ScheduledRunHistoryStatus,
    outputSummary: string | null,
    errorMessage: string | null,
    nextRunAtIso: string | null,
    notificationDispatched: boolean,
  ): ScheduledRunHistoryRecord | null {
    const db = getConnection();
    const runRow = db
      .prepare(
        `SELECT id, schedule_id, user_id, status, trigger, started_at, finished_at,
                duration_ms, output_summary, error_message, notification_dispatched
         FROM scheduled_run_history WHERE id = ?`,
      )
      .get(runId) as HistoryRow | undefined;
    if (!runRow) return null;

    const startMs = new Date(
      (runRow.started_at.includes('T') ? runRow.started_at : runRow.started_at.replace(' ', 'T') + 'Z'),
    ).getTime();
    const durationMs = Number.isFinite(startMs)
      ? Math.max(0, Date.now() - startMs)
      : null;

    const finishedAtIso = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

    db.prepare(
      `UPDATE scheduled_run_history SET
         status = ?, finished_at = ?, duration_ms = ?, output_summary = ?,
         error_message = ?, notification_dispatched = ?
       WHERE id = ?`,
    ).run(
      status,
      finishedAtIso,
      durationMs,
      outputSummary,
      errorMessage,
      notificationDispatched ? 1 : 0,
      runId,
    );

    if (nextRunAtIso) {
      db.prepare(
        `UPDATE scheduled_runs SET
           in_flight_run_id = NULL,
           next_run_at = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(nextRunAtIso, runRow.schedule_id);
    } else {
      db.prepare(
        `UPDATE scheduled_runs SET in_flight_run_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(runRow.schedule_id);
    }

    const updated = db
      .prepare(
        `SELECT id, schedule_id, user_id, status, trigger, started_at, finished_at,
                duration_ms, output_summary, error_message, notification_dispatched
         FROM scheduled_run_history WHERE id = ?`,
      )
      .get(runId) as HistoryRow | undefined;
    return updated ? normalizeHistory(updated) : null;
  },

  listHistory(scheduleId: number, limit: number = 50): ScheduledRunHistoryRecord[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT id, schedule_id, user_id, status, trigger, started_at, finished_at,
                duration_ms, output_summary, error_message, notification_dispatched
         FROM scheduled_run_history
         WHERE schedule_id = ?
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(scheduleId, limit) as HistoryRow[];
    return rows.map(normalizeHistory);
  },

  /**
   * On startup every persisted `running` row is orphaned because no provider
   * process from the previous server instance can still own it. Mark it failed
   * and clear the in-flight pointer without replaying the interrupted run.
   */
  repairOrphanedRuns(): number {
    const db = getConnection();
    const orphans = db
      .prepare(
        `SELECT id, schedule_id FROM scheduled_run_history
         WHERE status = 'running'`,
      )
      .all() as { id: number; schedule_id: number }[];

    if (orphans.length === 0) return 0;

    const finish = db.transaction(() => {
      for (const orphan of orphans) {
        db.prepare(
          `UPDATE scheduled_run_history SET
             status = 'failed',
             finished_at = CURRENT_TIMESTAMP,
             error_message = 'Server restarted during run.'
           WHERE id = ?`,
        ).run(orphan.id);
        db.prepare(
          `UPDATE scheduled_runs SET in_flight_run_id = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND in_flight_run_id = ?`,
        ).run(orphan.schedule_id, orphan.id);
      }
    });
    finish();
    return orphans.length;
  },
};
