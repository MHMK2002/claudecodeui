/**
 * Scheduler service for recurring agent runs.
 *
 * `startScheduler` boots a 60s tick loop that polls `scheduled_runs` for due
 * rows and fires them via the existing provider SDKs (`queryClaudeSDK`,
 * `queryCodex`, `spawnCursor`, `spawnOpenCode`). The tick interval handle is
 * stored on a module-level variable so `stopScheduler` can `clearInterval`
 * cleanly during graceful shutdown.
 *
 * `triggerManualRun` lets an HTTP caller fire a schedule immediately without
 * advancing `next_run_at`; the tick path will recompute it when the manual
 * run finishes.
 *
 * Atomic claim lives in `scheduledRunsRepository.claimNextRun` — see that
 * module for the transaction wrapping that prevents a tick and a manual
 * trigger from both succeeding for the same schedule.
 */

import { queryClaudeSDK } from '../../claude-sdk.js';
import { queryCodex } from '../../openai-codex.js';
import { spawnCursor } from '../../cursor-cli.js';
import { spawnOpenCode } from '../../opencode-cli.js';
import { scheduledRunsRepository } from '../database/index.js';
import { nextRunAt } from '../../utils/cron.js';
import {
  broadcastScheduledRunsChanged,
  broadcastScheduledRunFinished,
} from '../websocket/services/scheduled-runs-broadcast.service.js';
import {
  notifyScheduleRunSucceeded,
  notifyScheduleRunFailed,
} from '../notifications/services/notification-orchestrator.service.js';

const TICK_INTERVAL_MS = 60_000;
const RUN_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_SUMMARY_CAP_BYTES = 16 * 1024;

let tickHandle = null;
let isTicking = false;
const inFlightRuns = new Set();

/**
 * Minimal writer that satisfies the provider SDK contract: accepts the same
 * `{type, ...}` events the SDKs emit, extracts the last assistant text per
 * provider, and exposes a `getSessionId()` for downstream consumers.
 */
class CollectingWriter {
  constructor() {
    this.sessionId = null;
    this.assistantTexts = [];
  }

  send(data) {
    if (!data) return;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }

    if (data.sessionId) {
      this.sessionId = data.sessionId;
    }

    // Claude: { type: 'claude-response', data: { type: 'assistant', message: { content: [...] } } }
    if (data.type === 'claude-response' && data.data?.type === 'assistant') {
      const message = data.data.message;
      if (message && Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block && block.type === 'text' && typeof block.text === 'string') {
            this.assistantTexts.push(block.text);
          }
        }
      }
    }

    // Codex: { type: 'codex-response', data: { type: 'assistant', content: '...' } }
    // Cursor / OpenCode: pass through anything with a `text` field.
    if (
      data.type === 'codex-response' ||
      data.type === 'cursor-response' ||
      data.type === 'opencode-response'
    ) {
      const inner = data.data;
      if (inner) {
        if (typeof inner.text === 'string') {
          this.assistantTexts.push(inner.text);
        } else if (typeof inner.content === 'string') {
          this.assistantTexts.push(inner.content);
        }
      }
    }
  }

  end() {}

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  getSessionId() {
    return this.sessionId;
  }

  getOutputSummary() {
    const text = this.assistantTexts.join('\n\n').trim();
    if (!text) return '';
    if (text.length <= OUTPUT_SUMMARY_CAP_BYTES) return text;
    return text.slice(0, OUTPUT_SUMMARY_CAP_BYTES) + '\n\n...(truncated)';
  }
}

function withTimeout(promise, ms, errorMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runProvider(schedule) {
  const writer = new CollectingWriter();
  const baseOptions = {
    projectPath: schedule.projectPath,
    cwd: schedule.projectPath,
    sessionId: null,
  };

  switch (schedule.provider) {
    case 'claude':
      return withTimeout(
        queryClaudeSDK(
          schedule.prompt,
          {
            ...baseOptions,
            model: schedule.model,
            permissionMode: 'bypassPermissions',
          },
          writer,
        ).then(() => writer),
        RUN_TIMEOUT_MS,
        `Timed out after ${RUN_TIMEOUT_MS / 60_000} minutes.`,
      );

    case 'codex':
      return withTimeout(
        queryCodex(
          schedule.prompt,
          {
            ...baseOptions,
            model: schedule.model,
            permissionMode: 'bypassPermissions',
          },
          writer,
        ).then(() => writer),
        RUN_TIMEOUT_MS,
        `Timed out after ${RUN_TIMEOUT_MS / 60_000} minutes.`,
      );

    case 'cursor':
      return withTimeout(
        spawnCursor(
          schedule.prompt,
          {
            ...baseOptions,
            model: schedule.model,
            skipPermissions: true,
          },
          writer,
        ).then(() => writer),
        RUN_TIMEOUT_MS,
        `Timed out after ${RUN_TIMEOUT_MS / 60_000} minutes.`,
      );

    case 'opencode':
      return withTimeout(
        spawnOpenCode(
          schedule.prompt,
          {
            ...baseOptions,
            model: schedule.model,
            permissionMode: 'bypassPermissions',
          },
          writer,
        ).then(() => writer),
        RUN_TIMEOUT_MS,
        `Timed out after ${RUN_TIMEOUT_MS / 60_000} minutes.`,
      );

    default:
      throw new Error(`Unknown provider: ${schedule.provider}`);
  }
}

async function executeRun({ run, schedule }) {
  const task = (async () => {
    const startedAtMs = Date.now();
    try {
      const writer = await runProvider(schedule);
      const output = writer.getOutputSummary() || '(no output captured)';
      let notificationDispatched = false;
      try {
        if (schedule.notifyOnSuccess) {
          notifyScheduleRunSucceeded({
            schedule: { ...schedule, userId: schedule.userId },
            run: { ...run, durationMs: Date.now() - startedAtMs },
            summary: output,
          });
          notificationDispatched = true;
        }
      } catch (notifError) {
        console.error('[Scheduler] notifyScheduleRunSucceeded threw:', notifError);
      }
      const finished = scheduledRunsRepository.finishRun(
        run.id,
        'succeeded',
        output,
        null,
        computeNextRunIso(schedule),
        notificationDispatched,
      );
      broadcastScheduledRunFinished(schedule.userId, {
        scheduleId: schedule.id,
        runId: run.id,
        status: 'succeeded',
        summary: (output || '').slice(0, 240),
      });
      broadcastScheduledRunsChanged(schedule.userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let notificationDispatched = false;
      try {
        if (schedule.notifyOnFailure) {
          notifyScheduleRunFailed({
            schedule: { ...schedule, userId: schedule.userId },
            run: { ...run },
            errorMessage: message,
          });
          notificationDispatched = true;
        }
      } catch (notifError) {
        console.error('[Scheduler] notifyScheduleRunFailed threw:', notifError);
      }
      scheduledRunsRepository.finishRun(
        run.id,
        'failed',
        null,
        message,
        computeNextRunIso(schedule),
        notificationDispatched,
      );
      broadcastScheduledRunFinished(schedule.userId, {
        scheduleId: schedule.id,
        runId: run.id,
        status: 'failed',
        errorMessage: message,
      });
      broadcastScheduledRunsChanged(schedule.userId);
    }
  })();

  inFlightRuns.add(task);
  try {
    await task;
  } finally {
    inFlightRuns.delete(task);
  }
}

function computeNextRunIso(schedule) {
  try {
    return nextRunAt(schedule.cronExpression, schedule.timezone, new Date())
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, '');
  } catch {
    return null;
  }
}

async function tick() {
  if (isTicking) {
    console.debug('[Scheduler] Previous tick still running; skipping.');
    return;
  }
  isTicking = true;
  try {
    const due = scheduledRunsRepository.listDue(new Date());
    for (const schedule of due) {
      const claim = scheduledRunsRepository.claimNextRun(schedule.id, 'tick');
      if (!claim) continue; // already in flight or vanished
      // fire-and-forget; executeRun handles errors internally
      executeRun(claim).catch((error) => {
        console.error('[Scheduler] executeRun unhandled error:', error);
      });
    }
  } catch (error) {
    console.error('[Scheduler] tick error:', error);
  } finally {
    isTicking = false;
  }
}

export async function startScheduler() {
  if (tickHandle) return; // idempotent

  const repaired = scheduledRunsRepository.repairOrphanedRuns();
  if (repaired > 0) {
    console.log(`[Scheduler] Repaired ${repaired} orphaned run(s) from a previous crash.`);
  }

  tickHandle = setInterval(() => {
    tick().catch((error) => console.error('[Scheduler] tick threw:', error));
  }, TICK_INTERVAL_MS);
  // Run once at startup so a server that comes back up across a due time
  // still fires schedules due during downtime (no replay of older missed
  // windows).
  tick().catch((error) => console.error('[Scheduler] initial tick threw:', error));

  console.log(`[Scheduler] Started (tick=${TICK_INTERVAL_MS / 1000}s, timeout=${RUN_TIMEOUT_MS / 60_000}m).`);
}

export async function stopScheduler() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  if (inFlightRuns.size > 0) {
    console.log(`[Scheduler] Waiting for ${inFlightRuns.size} in-flight run(s) to finish...`);
    try {
      await Promise.allSettled([...inFlightRuns]);
    } catch {
      // errors are logged inside executeRun; nothing to do here
    }
  }
  console.log('[Scheduler] Stopped.');
}

export async function triggerManualRun(userId, scheduleId) {
  const schedule = scheduledRunsRepository.getById(userId, scheduleId);
  if (!schedule) return { error: 'Schedule not found.' };

  const claim = scheduledRunsRepository.claimNextRun(scheduleId, 'manual');
  if (!claim) {
    return { error: 'A run is already in progress for this schedule.' };
  }

  executeRun(claim).catch((error) => {
    console.error('[Scheduler] manual executeRun unhandled error:', error);
  });

  return { runId: claim.run.id };
}
