/**
 * REST routes for scheduled agent runs.
 *
 * Endpoints (all under /api/scheduled-runs, authenticated by UI JWT or external API key):
 *   GET    /                — list user's schedules
 *   POST   /                — create a new schedule
 *   GET    /:id             — fetch one schedule
 *   PATCH  /:id             — partial update
 *   DELETE /:id             — delete
 *   POST   /:id/enable      — flip is_enabled=1
 *   POST   /:id/disable     — flip is_enabled=0
 *   POST   /:id/run-now     — trigger an immediate run (delegates to scheduler service)
 *   GET    /:id/history     — list run history rows for this schedule
 */

import express from 'express';

import { scheduledRunsRepository } from '../modules/database/index.js';
import { validateExternalApiKeyOrJwt } from '../middleware/api-key.js';
import { validateCron, nextRunAt } from '../utils/cron.js';
import { triggerManualRun } from '../modules/scheduler/scheduler.service.js';
import { broadcastScheduledRunsChanged } from '../modules/websocket/services/scheduled-runs-broadcast.service.js';

const router = express.Router();

router.use(validateExternalApiKeyOrJwt);

const VALID_PROVIDERS = new Set(['claude', 'codex', 'cursor', 'opencode']);
const SUPPORTED_TIMEZONES = (() => {
  const set = new Set(Intl.supportedValuesOf('timeZone'));
  // Intl.supportedValuesOf('timeZone') omits UTC in some runtimes; add it
  // explicitly so the default timezone value is accepted.
  set.add('UTC');
  return set;
})();
const MAX_TITLE_LENGTH = 120;
const MAX_MODEL_LENGTH = 200;
const MAX_PROMPT_LENGTH = 32_000;

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function currentNextRun(res, body) {
  try {
    return nextRunAt(body.cronExpression, body.timezone, new Date());
  } catch (error) {
    return null;
  }
}

function validateScheduleBody(body, { partial = false } = {}) {
  const errors = [];

  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      errors.push('title is required and must be a non-empty string');
    } else if (body.title.length > MAX_TITLE_LENGTH) {
      errors.push(`title must be at most ${MAX_TITLE_LENGTH} characters`);
    }
  }

  if (!partial || body.projectPath !== undefined) {
    if (typeof body.projectPath !== 'string' || body.projectPath.trim().length === 0) {
      errors.push('projectPath is required');
    }
  }

  if (!partial || body.provider !== undefined) {
    if (!VALID_PROVIDERS.has(body.provider)) {
      errors.push(`provider must be one of: ${[...VALID_PROVIDERS].join(', ')}`);
    }
  }

  if (!partial || body.model !== undefined) {
    if (typeof body.model !== 'string' || body.model.trim().length === 0) {
      errors.push('model is required');
    } else if (body.model.length > MAX_MODEL_LENGTH) {
      errors.push(`model must be at most ${MAX_MODEL_LENGTH} characters`);
    }
  }

  if (!partial || body.prompt !== undefined) {
    if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
      errors.push('prompt is required');
    } else if (body.prompt.length > MAX_PROMPT_LENGTH) {
      errors.push(`prompt must be at most ${MAX_PROMPT_LENGTH} characters`);
    }
  }

  if (!partial || body.cronExpression !== undefined) {
    const result = validateCron(body.cronExpression);
    if (!result.ok) {
      errors.push(result.error);
    }
  }

  if (!partial || body.timezone !== undefined) {
    if (typeof body.timezone !== 'string' || !SUPPORTED_TIMEZONES.has(body.timezone)) {
      errors.push('timezone must be a valid IANA timezone string');
    }
  }

  if (body.notifyOnSuccess !== undefined && typeof body.notifyOnSuccess !== 'boolean') {
    errors.push('notifyOnSuccess must be a boolean');
  }
  if (body.notifyOnFailure !== undefined && typeof body.notifyOnFailure !== 'boolean') {
    errors.push('notifyOnFailure must be a boolean');
  }

  if (body.notifyChannels !== undefined && body.notifyChannels !== null) {
    if (!Array.isArray(body.notifyChannels) || body.notifyChannels.some((c) => typeof c !== 'string')) {
      errors.push('notifyChannels must be an array of strings or null');
    }
  }

  if (body.isEnabled !== undefined && typeof body.isEnabled !== 'boolean') {
    errors.push('isEnabled must be a boolean');
  }

  return errors;
}

function nextRunIso(body, fallback) {
  try {
    const next = nextRunAt(body.cronExpression, body.timezone, new Date());
    return next.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  } catch {
    return fallback ?? null;
  }
}

router.get('/', (req, res) => {
  const userId = req.user.id;
  const schedules = scheduledRunsRepository.list(userId);
  res.json({ schedules });
});

router.post('/', (req, res) => {
  const userId = req.user.id;
  const errors = validateScheduleBody(req.body, { partial: false });
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  let nextRunIsoValue;
  try {
    nextRunIsoValue = nextRunAt(req.body.cronExpression, req.body.timezone, new Date())
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, '');
  } catch (error) {
    return badRequest(res, error.message);
  }

  const schedule = scheduledRunsRepository.create(userId, {
    title: req.body.title.trim(),
    projectPath: req.body.projectPath,
    provider: req.body.provider,
    model: req.body.model,
    prompt: req.body.prompt,
    cronExpression: req.body.cronExpression.trim(),
    timezone: req.body.timezone,
    notifyOnSuccess: Boolean(req.body.notifyOnSuccess),
    notifyOnFailure: req.body.notifyOnFailure === undefined ? true : Boolean(req.body.notifyOnFailure),
    notifyChannels: req.body.notifyChannels ?? null,
    isEnabled: req.body.isEnabled === undefined ? true : Boolean(req.body.isEnabled),
    nextRunAt: nextRunIsoValue,
  });

  broadcastScheduledRunsChanged(userId);
  res.json({ schedule });
});

router.get('/:id', (req, res) => {
  const userId = req.user.id;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return badRequest(res, 'id must be an integer');

  const schedule = scheduledRunsRepository.getById(userId, id);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found.' });
  res.json({ schedule });
});

router.patch('/:id', (req, res) => {
  const userId = req.user.id;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return badRequest(res, 'id must be an integer');

  const existing = scheduledRunsRepository.getById(userId, id);
  if (!existing) return res.status(404).json({ error: 'Schedule not found.' });

  const errors = validateScheduleBody(req.body, { partial: true });
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  const patch = { ...req.body };

  // Recompute next_run_at when cron or timezone changes.
  const cronChanged =
    (patch.cronExpression !== undefined && patch.cronExpression !== existing.cronExpression) ||
    (patch.timezone !== undefined && patch.timezone !== existing.timezone);

  if (cronChanged) {
    const nextRun = nextRunIso(
      {
        cronExpression: patch.cronExpression ?? existing.cronExpression,
        timezone: patch.timezone ?? existing.timezone,
      },
      existing.nextRunAt,
    );
    if (nextRun) {
      patch.nextRunAt = nextRun;
    }
  }

  const updated = scheduledRunsRepository.update(userId, id, patch);
  if (!updated) return res.status(404).json({ error: 'Schedule not found.' });
  broadcastScheduledRunsChanged(userId);
  res.json({ schedule: updated });
});

router.delete('/:id', (req, res) => {
  const userId = req.user.id;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return badRequest(res, 'id must be an integer');

  const removed = scheduledRunsRepository.delete(userId, id);
  if (!removed) return res.status(404).json({ error: 'Schedule not found.' });
  broadcastScheduledRunsChanged(userId);
  res.json({ ok: true });
});

router.post('/:id/enable', (req, res) => {
  const userId = req.user.id;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return badRequest(res, 'id must be an integer');

  const updated = scheduledRunsRepository.setEnabled(userId, id, true);
  if (!updated) return res.status(404).json({ error: 'Schedule not found.' });
  broadcastScheduledRunsChanged(userId);
  res.json({ schedule: updated });
});

router.post('/:id/disable', (req, res) => {
  const userId = req.user.id;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return badRequest(res, 'id must be an integer');

  const updated = scheduledRunsRepository.setEnabled(userId, id, false);
  if (!updated) return res.status(404).json({ error: 'Schedule not found.' });
  broadcastScheduledRunsChanged(userId);
  res.json({ schedule: updated });
});

router.post('/:id/run-now', async (req, res) => {
  const userId = req.user.id;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return badRequest(res, 'id must be an integer');

  const existing = scheduledRunsRepository.getById(userId, id);
  if (!existing) return res.status(404).json({ error: 'Schedule not found.' });

  const result = await triggerManualRun(userId, id);
  if ('error' in result) {
    return res.status(409).json({ error: result.error });
  }
  res.json({ runId: result.runId });
});

router.get('/:id/history', (req, res) => {
  const userId = req.user.id;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return badRequest(res, 'id must be an integer');

  const existing = scheduledRunsRepository.getById(userId, id);
  if (!existing) return res.status(404).json({ error: 'Schedule not found.' });

  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const history = scheduledRunsRepository.listHistory(id, limit);
  res.json({ history });
});

export default router;
