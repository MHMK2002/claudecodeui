import express, { type Request, type Response } from 'express';

import { readAuthenticatedUserId } from '@/shared/utils.js';
import type {
  LLMProvider,
  ScheduledRunMutationInput,
  ScheduledRunMutationPatch,
} from '@/shared/types.js';

import { validateCron } from './cron.js';
import {
  ScheduledRunsServiceError,
  scheduledRunsService,
} from './scheduled-runs.service.js';

const VALID_PROVIDERS = new Set<LLMProvider>(['claude', 'codex', 'cursor', 'opencode']);
const SUPPORTED_TIMEZONES = new Set<string>([...Intl.supportedValuesOf('timeZone'), 'UTC']);
const MAX_TITLE_LENGTH = 120;
const MAX_MODEL_LENGTH = 200;
const MAX_PROMPT_LENGTH = 32_000;

type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type ScheduledRunsService = typeof scheduledRunsService;

function recordBody(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}

function nonEmptyString(
  body: Record<string, unknown>,
  field: string,
  errors: string[],
  options: { required: boolean; maxLength?: number },
): string | undefined {
  const value = body[field];
  if (value === undefined && !options.required) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${field} is required and must be a non-empty string`);
    return undefined;
  }
  if (options.maxLength && value.length > options.maxLength) {
    errors.push(`${field} must be at most ${options.maxLength} characters`);
    return undefined;
  }
  return value.trim();
}

function optionalBoolean(body: Record<string, unknown>, field: string, errors: string[]): boolean | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    errors.push(`${field} must be a boolean`);
    return undefined;
  }
  return value;
}

function optionalProfileId(
  body: Record<string, unknown>,
  errors: string[],
): number | null | undefined {
  const value = body.providerProfileId;
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    errors.push('providerProfileId must be a positive integer or null');
    return undefined;
  }
  return value as number;
}

function optionalNotifyChannels(
  body: Record<string, unknown>,
  errors: string[],
): string[] | null | undefined {
  const value = body.notifyChannels;
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((channel) => typeof channel !== 'string')) {
    errors.push('notifyChannels must be an array of strings or null');
    return undefined;
  }
  return value;
}

function parseProvider(
  body: Record<string, unknown>,
  errors: string[],
  required: boolean,
): LLMProvider | undefined {
  const value = body.provider;
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !VALID_PROVIDERS.has(value as LLMProvider)) {
    errors.push(`provider must be one of: ${[...VALID_PROVIDERS].join(', ')}`);
    return undefined;
  }
  return value as LLMProvider;
}

function validateTiming(
  body: Record<string, unknown>,
  errors: string[],
  required: boolean,
): { cronExpression?: string; timezone?: string } {
  const cronExpression = nonEmptyString(body, 'cronExpression', errors, { required });
  if (cronExpression !== undefined) {
    const validation = validateCron(cronExpression);
    if (!validation.ok) errors.push(validation.error);
  }
  const timezone = nonEmptyString(body, 'timezone', errors, { required });
  if (timezone !== undefined && !SUPPORTED_TIMEZONES.has(timezone)) {
    errors.push('timezone must be a valid IANA timezone string');
  }
  return { cronExpression, timezone };
}

function parseCreateBody(rawBody: unknown): ParseResult<ScheduledRunMutationInput> {
  const body = recordBody(rawBody);
  const errors: string[] = [];
  const title = nonEmptyString(body, 'title', errors, { required: true, maxLength: MAX_TITLE_LENGTH });
  const projectId = nonEmptyString(body, 'projectId', errors, { required: true });
  const provider = parseProvider(body, errors, true);
  const providerProfileId = optionalProfileId(body, errors) ?? null;
  const model = nonEmptyString(body, 'model', errors, { required: true, maxLength: MAX_MODEL_LENGTH });
  const prompt = nonEmptyString(body, 'prompt', errors, { required: true, maxLength: MAX_PROMPT_LENGTH });
  const { cronExpression, timezone } = validateTiming(body, errors, true);
  const notifyOnSuccess = optionalBoolean(body, 'notifyOnSuccess', errors) ?? false;
  const notifyOnFailure = optionalBoolean(body, 'notifyOnFailure', errors) ?? true;
  const notifyChannels = optionalNotifyChannels(body, errors) ?? null;
  const isEnabled = optionalBoolean(body, 'isEnabled', errors) ?? true;
  if (errors.length > 0 || !title || !projectId || !provider || !model || !prompt || !cronExpression || !timezone) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      title,
      projectId,
      provider,
      providerProfileId,
      model,
      prompt,
      cronExpression,
      timezone,
      notifyOnSuccess,
      notifyOnFailure,
      notifyChannels,
      isEnabled,
    },
  };
}

function parsePatchBody(rawBody: unknown): ParseResult<ScheduledRunMutationPatch> {
  const body = recordBody(rawBody);
  const errors: string[] = [];
  const value: ScheduledRunMutationPatch = {};
  const title = nonEmptyString(body, 'title', errors, { required: false, maxLength: MAX_TITLE_LENGTH });
  const projectId = nonEmptyString(body, 'projectId', errors, { required: false });
  const provider = parseProvider(body, errors, false);
  const providerProfileId = optionalProfileId(body, errors);
  const model = nonEmptyString(body, 'model', errors, { required: false, maxLength: MAX_MODEL_LENGTH });
  const prompt = nonEmptyString(body, 'prompt', errors, { required: false, maxLength: MAX_PROMPT_LENGTH });
  const { cronExpression, timezone } = validateTiming(body, errors, false);
  const notifyOnSuccess = optionalBoolean(body, 'notifyOnSuccess', errors);
  const notifyOnFailure = optionalBoolean(body, 'notifyOnFailure', errors);
  const notifyChannels = optionalNotifyChannels(body, errors);
  const isEnabled = optionalBoolean(body, 'isEnabled', errors);
  if (title !== undefined) value.title = title;
  if (projectId !== undefined) value.projectId = projectId;
  if (provider !== undefined) value.provider = provider;
  if (providerProfileId !== undefined) value.providerProfileId = providerProfileId;
  if (model !== undefined) value.model = model;
  if (prompt !== undefined) value.prompt = prompt;
  if (cronExpression !== undefined) value.cronExpression = cronExpression;
  if (timezone !== undefined) value.timezone = timezone;
  if (notifyOnSuccess !== undefined) value.notifyOnSuccess = notifyOnSuccess;
  if (notifyOnFailure !== undefined) value.notifyOnFailure = notifyOnFailure;
  if (notifyChannels !== undefined) value.notifyChannels = notifyChannels;
  if (isEnabled !== undefined) value.isEnabled = isEnabled;
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

function parseId(rawId: string): number | null {
  const id = Number.parseInt(rawId, 10);
  return Number.isInteger(id) && String(id) === rawId ? id : null;
}

function userId(req: Request): number {
  return readAuthenticatedUserId(req);
}

function sendFailure(res: Response, error: unknown): Response {
  if (error instanceof ScheduledRunsServiceError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  console.error('[ScheduledRuns] Unexpected route failure:', error);
  return res.status(500).json({ error: 'Scheduled run request failed unexpectedly.', code: 'INTERNAL_ERROR' });
}

/** Creates thin authenticated Schedules routes around the injected service. */
export function createScheduledRunsRouter(service: ScheduledRunsService = scheduledRunsService): express.Router {
  const router = express.Router();

  router.get('/', (req, res) => {
    try {
      return res.json({ schedules: service.list(userId(req)) });
    } catch (error) {
      return sendFailure(res, error);
    }
  });

  router.post('/', async (req, res) => {
    const parsed = parseCreateBody(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.errors.join('; '), code: 'INVALID_SCHEDULE' });
    try {
      const schedule = await service.create(userId(req), parsed.value);
      return res.status(201).json({ schedule });
    } catch (error) {
      return sendFailure(res, error);
    }
  });

  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'id must be an integer', code: 'INVALID_ID' });
    try {
      return res.json({ schedule: service.get(userId(req), id) });
    } catch (error) {
      return sendFailure(res, error);
    }
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'id must be an integer', code: 'INVALID_ID' });
    const parsed = parsePatchBody(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.errors.join('; '), code: 'INVALID_SCHEDULE' });
    try {
      return res.json({ schedule: await service.update(userId(req), id, parsed.value) });
    } catch (error) {
      return sendFailure(res, error);
    }
  });

  router.delete('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'id must be an integer', code: 'INVALID_ID' });
    try {
      service.remove(userId(req), id);
      return res.json({ ok: true });
    } catch (error) {
      return sendFailure(res, error);
    }
  });

  for (const [path, enabled] of [['enable', true], ['disable', false]] as const) {
    router.post(`/:id/${path}`, async (req, res) => {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id must be an integer', code: 'INVALID_ID' });
      try {
        return res.json({ schedule: await service.setEnabled(userId(req), id, enabled) });
      } catch (error) {
        return sendFailure(res, error);
      }
    });
  }

  router.post('/:id/run-now', async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'id must be an integer', code: 'INVALID_ID' });
    try {
      return res.json(await service.runNow(userId(req), id));
    } catch (error) {
      return sendFailure(res, error);
    }
  });

  router.get('/:id/history', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'id must be an integer', code: 'INVALID_ID' });
    const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 50;
    const limit = Math.min(200, Math.max(1, Number.isInteger(rawLimit) ? rawLimit : 50));
    try {
      return res.json({ history: service.history(userId(req), id, limit) });
    } catch (error) {
      return sendFailure(res, error);
    }
  });

  return router;
}

export default createScheduledRunsRouter();
