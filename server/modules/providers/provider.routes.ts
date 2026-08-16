import express, { type Request, type Response } from 'express';

import { providerProfilesDb } from '@/modules/database/index.js';
import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { providerSelectionService } from '@/modules/providers/services/provider-selection.service.js';
import { providerTokenUsageService } from '@/modules/providers/services/provider-token-usage.service.js';
import { providerSkillsService } from '@/modules/providers/services/skills.service.js';
import { createProviderSelectionCatalogRouter } from '@/modules/providers/provider-selection.routes.js';
import { sessionConversationsSearchService } from '@/modules/providers/services/session-conversations-search.service.js';
import { sessionExportService } from '@/modules/providers/services/session-export.service.js';
import {
  sessionRewindService,
  type SessionRewindMode,
} from '@/modules/providers/services/session-rewind.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type {
  LLMProvider,
  McpScope,
  McpTransport,
  ProviderProfileAuthType,
  ProviderProfileProvider,
  ProviderProfileRuntime,
  ProviderSkillCreateFile,
  ProviderSkillCreateInput,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse, readAuthenticatedUserId } from '@/shared/utils.js';

const router = express.Router();

const readPathParam = (value: unknown, name: string): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  throw new AppError(`${name} path parameter is invalid.`, {
    code: 'INVALID_PATH_PARAMETER',
    statusCode: 400,
  });
};

const normalizeProviderParam = (value: unknown): string =>
  readPathParam(value, 'provider').trim().toLowerCase();

const SESSION_ID_PATTERN = /^[a-zA-Z0-9._-]{1,120}$/;

const parseSessionId = (value: unknown): string => {
  const sessionId = readPathParam(value, 'sessionId').trim();
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new AppError('Invalid sessionId.', {
      code: 'INVALID_SESSION_ID',
      statusCode: 400,
    });
  }

  return sessionId;
};

const readOptionalQueryString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const parseOptionalBooleanQuery = (value: unknown, name: string): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = readOptionalQueryString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  throw new AppError(`${name} must be "true" or "false".`, {
    code: 'INVALID_QUERY_PARAMETER',
    statusCode: 400,
  });
};

const parseMcpScope = (value: unknown): McpScope | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = readOptionalQueryString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'user' || normalized === 'local' || normalized === 'project') {
    return normalized;
  }

  throw new AppError(`Unsupported MCP scope "${normalized}".`, {
    code: 'INVALID_MCP_SCOPE',
    statusCode: 400,
  });
};

const parseProviderProfileId = (value: unknown): number => {
  const rawValue = readPathParam(value, 'profileId').trim();
  const parsed = /^\d+$/.test(rawValue) ? Number(rawValue) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError('Invalid profileId.', {
      code: 'INVALID_PROVIDER_PROFILE_ID',
      statusCode: 400,
    });
  }
  return parsed;
};

const parseOptionalProviderProfileId = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? (/^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN)
      : NaN;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError('providerProfileId must be a positive integer.', {
      code: 'INVALID_PROVIDER_PROFILE_ID',
      statusCode: 400,
    });
  }

  return parsed;
};

const parseRequiredProviderProfileId = (body: Record<string, unknown>): number | null => {
  if (!Object.prototype.hasOwnProperty.call(body, 'providerProfileId')) {
    throw new AppError('providerProfileId is required (use null for connection-backed providers).', {
      code: 'PROVIDER_PROFILE_FIELD_REQUIRED',
      statusCode: 400,
    });
  }
  return parseOptionalProviderProfileId(body.providerProfileId);
};

const isProfileProvider = (provider: LLMProvider): provider is ProviderProfileProvider => (
  provider === 'claude' || provider === 'codex'
);

const resolveSessionProviderProfile = (
  req: Request,
  sessionId: string,
): ProviderProfileRuntime | null => {
  const session = sessionsService.getSessionContext(sessionId);
  if (session.providerProfileId === null) {
    return null;
  }
  if (!isProfileProvider(session.provider)) {
    throw new AppError('This session has an unsupported provider profile.', {
      code: 'PROVIDER_PROFILE_UNSUPPORTED',
      statusCode: 400,
    });
  }

  const profile = providerProfilesDb.getProviderProfileForRuntime(
    readAuthenticatedUserId(req),
    session.provider,
    session.providerProfileId,
  );
  if (!profile) {
    throw new AppError('Provider profile not found or inactive.', {
      code: 'PROVIDER_PROFILE_NOT_FOUND',
      statusCode: 404,
    });
  }
  return profile;
};

const parseSessionRewindMode = (value: unknown): SessionRewindMode => {
  if (value === undefined || value === null || value === '') {
    return 'conversation';
  }
  if (value === 'conversation' || value === 'code' || value === 'both') {
    return value;
  }
  throw new AppError('mode must be conversation, code, or both.', {
    code: 'INVALID_REQUEST_BODY',
    statusCode: 400,
  });
};

const parseProfileProvider = (value: unknown): ProviderProfileProvider => {
  const provider = parseProvider(value);
  if (!isProfileProvider(provider)) {
    throw new AppError('Provider profiles are currently supported for Claude and Codex only.', {
      code: 'PROVIDER_PROFILES_UNSUPPORTED',
      statusCode: 404,
    });
  }

  return provider;
};

const parseProviderProfileAuthType = (
  provider: ProviderProfileProvider,
  value: unknown,
): ProviderProfileAuthType => {
  if (provider === 'codex') {
    if (value === undefined || value === null || value === '' || value === 'api_key') {
      return 'api_key';
    }

    throw new AppError('Codex provider profiles support api_key auth only.', {
      code: 'INVALID_PROVIDER_PROFILE_AUTH_TYPE',
      statusCode: 400,
    });
  }

  if (value === undefined || value === null || value === '') {
    return 'auth_token';
  }

  if (value === 'auth_token' || value === 'api_key') {
    return value;
  }

  throw new AppError('authType must be "auth_token" or "api_key".', {
    code: 'INVALID_PROVIDER_PROFILE_AUTH_TYPE',
    statusCode: 400,
  });
};

const readOptionalBodyString = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new AppError(`${key} must be a string.`, {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }
  return value.trim();
};

const parseProviderProfileBaseUrl = (value: string | undefined): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Unsupported protocol.');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new AppError('baseUrl must be a valid http(s) URL.', {
      code: 'INVALID_PROVIDER_PROFILE_BASE_URL',
      statusCode: 400,
    });
  }
};

const readProviderProfileSecret = (body: Record<string, unknown>): string | undefined => (
  readOptionalBodyString(body, 'secretValue')
  ?? readOptionalBodyString(body, 'token')
  ?? readOptionalBodyString(body, 'secret')
);

const parseProviderProfileCreatePayload = (
  provider: ProviderProfileProvider,
  payload: unknown,
) => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const title = readOptionalBodyString(body, 'title');
  const secretValue = readProviderProfileSecret(body);
  if (!title) {
    throw new AppError('title is required.', {
      code: 'PROVIDER_PROFILE_TITLE_REQUIRED',
      statusCode: 400,
    });
  }
  if (!secretValue) {
    throw new AppError('token is required.', {
      code: 'PROVIDER_PROFILE_TOKEN_REQUIRED',
      statusCode: 400,
    });
  }
  const baseUrl = parseProviderProfileBaseUrl(readOptionalBodyString(body, 'baseUrl')) ?? null;
  if (provider === 'codex' && !baseUrl) {
    throw new AppError('baseUrl is required for Codex provider profiles.', {
      code: 'PROVIDER_PROFILE_BASE_URL_REQUIRED',
      statusCode: 400,
    });
  }

  return {
    title,
    baseUrl,
    authType: parseProviderProfileAuthType(provider, body.authType),
    secretValue,
    isDefault: body.isDefault === true,
    isActive: body.isActive !== false,
  };
};

const parseProviderProfileUpdatePayload = (
  provider: ProviderProfileProvider,
  payload: unknown,
) => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const title = readOptionalBodyString(body, 'title');
  const baseUrl = parseProviderProfileBaseUrl(readOptionalBodyString(body, 'baseUrl'));
  const secretValue = readProviderProfileSecret(body);

  if (title !== undefined && !title) {
    throw new AppError('title must not be empty.', {
      code: 'PROVIDER_PROFILE_TITLE_REQUIRED',
      statusCode: 400,
    });
  }
  if (provider === 'codex' && baseUrl === null) {
    throw new AppError('baseUrl must not be empty for Codex provider profiles.', {
      code: 'PROVIDER_PROFILE_BASE_URL_REQUIRED',
      statusCode: 400,
    });
  }

  return {
    ...(title !== undefined ? { title } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(body.authType !== undefined ? { authType: parseProviderProfileAuthType(provider, body.authType) } : {}),
    ...(secretValue ? { secretValue } : {}),
    ...(body.isDefault !== undefined ? { isDefault: body.isDefault === true } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive === true } : {}),
  };
};

const parseMcpTransport = (value: unknown): McpTransport => {
  const normalized = readOptionalQueryString(value);
  if (!normalized) {
    throw new AppError('transport is required.', {
      code: 'MCP_TRANSPORT_REQUIRED',
      statusCode: 400,
    });
  }

  if (normalized === 'stdio' || normalized === 'http' || normalized === 'sse') {
    return normalized;
  }

  throw new AppError(`Unsupported MCP transport "${normalized}".`, {
    code: 'INVALID_MCP_TRANSPORT',
    statusCode: 400,
  });
};

const parseMcpUpsertPayload = (payload: unknown): UpsertProviderMcpServerInput => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const name = readOptionalQueryString(body.name);
  if (!name) {
    throw new AppError('name is required.', {
      code: 'MCP_NAME_REQUIRED',
      statusCode: 400,
    });
  }

  const transport = parseMcpTransport(body.transport);
  const scope = parseMcpScope(body.scope);
  const workspacePath = readOptionalQueryString(body.workspacePath);

  return {
    name,
    transport,
    scope,
    workspacePath,
    command: readOptionalQueryString(body.command),
    args: Array.isArray(body.args) ? body.args.filter((entry): entry is string => typeof entry === 'string') : undefined,
    env: typeof body.env === 'object' && body.env !== null
      ? Object.fromEntries(
        Object.entries(body.env as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
      : undefined,
    cwd: readOptionalQueryString(body.cwd),
    url: readOptionalQueryString(body.url),
    headers: typeof body.headers === 'object' && body.headers !== null
      ? Object.fromEntries(
        Object.entries(body.headers as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
      : undefined,
    envVars: Array.isArray(body.envVars)
      ? body.envVars.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    bearerTokenEnvVar: readOptionalQueryString(body.bearerTokenEnvVar),
    envHttpHeaders: typeof body.envHttpHeaders === 'object' && body.envHttpHeaders !== null
      ? Object.fromEntries(
        Object.entries(body.envHttpHeaders as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
      : undefined,
  };
};

const parseProviderSkillCreatePayload = (payload: unknown): ProviderSkillCreateInput => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const rawEntries = Array.isArray(body.entries)
    ? body.entries
    : typeof body.content === 'string'
      ? [{
          content: body.content,
          directoryName: body.directoryName,
          fileName: body.fileName,
          files: body.files,
        }]
      : null;

  if (!rawEntries || rawEntries.length === 0) {
    throw new AppError('At least one skill entry is required.', {
      code: 'PROVIDER_SKILLS_REQUIRED',
      statusCode: 400,
    });
  }

  const entries = rawEntries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new AppError(`Skill entry ${index + 1} must be an object.`, {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }

    const record = entry as Record<string, unknown>;
    const content = typeof record.content === 'string' ? record.content : '';
    const directoryName = readOptionalQueryString(record.directoryName);
    const fileName = readOptionalQueryString(record.fileName);
    const rawFiles = record.files;

    if (!content.trim()) {
      throw new AppError(`Skill entry ${index + 1} must include markdown content.`, {
        code: 'PROVIDER_SKILL_CONTENT_REQUIRED',
        statusCode: 400,
      });
    }

    if (rawFiles !== undefined && !Array.isArray(rawFiles)) {
      throw new AppError(`Skill entry ${index + 1} files must be an array.`, {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }

    const files: ProviderSkillCreateFile[] | undefined = rawFiles?.map((file, fileIndex) => {
      if (!file || typeof file !== 'object') {
        throw new AppError(`Skill entry ${index + 1} file ${fileIndex + 1} must be an object.`, {
          code: 'INVALID_REQUEST_BODY',
          statusCode: 400,
        });
      }

      const fileRecord = file as Record<string, unknown>;
      const relativePath = readOptionalQueryString(fileRecord.relativePath);
      const fileContent = typeof fileRecord.content === 'string' ? fileRecord.content : null;
      const encoding = fileRecord.encoding === 'utf8' || fileRecord.encoding === 'base64'
        ? fileRecord.encoding
        : null;

      if (!relativePath || fileContent === null || !encoding) {
        throw new AppError(
          `Skill entry ${index + 1} file ${fileIndex + 1} requires relativePath, content, and encoding.`,
          {
            code: 'INVALID_REQUEST_BODY',
            statusCode: 400,
          },
        );
      }

      return {
        relativePath,
        content: fileContent,
        encoding,
      };
    });

    return {
      content,
      directoryName,
      fileName,
      files,
    };
  });

  return { entries };
};

const parseProvider = (value: unknown): LLMProvider => {
  const normalized = normalizeProviderParam(value);
  if (
    normalized === 'claude'
    || normalized === 'codex'
    || normalized === 'cursor'
    || normalized === 'opencode'
  ) {
    return normalized;
  }

  throw new AppError(`Unsupported provider "${normalized}".`, {
    code: 'UNSUPPORTED_PROVIDER',
    statusCode: 400,
  });
};

const parseSessionRenameSummary = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (!summary) {
    throw new AppError('Summary is required.', {
      code: 'INVALID_SESSION_SUMMARY',
      statusCode: 400,
    });
  }

  if (summary.length > 500) {
    throw new AppError('Summary must not exceed 500 characters.', {
      code: 'INVALID_SESSION_SUMMARY',
      statusCode: 400,
    });
  }

  return summary;
};

const parseSessionSearchQuery = (value: unknown): string => {
  const query = readOptionalQueryString(value) ?? '';
  if (query.length < 2) {
    throw new AppError('Query must be at least 2 characters', {
      code: 'INVALID_SEARCH_QUERY',
      statusCode: 400,
    });
  }

  return query;
};

const parseSessionSearchLimit = (value: unknown): number => {
  const raw = readOptionalQueryString(value);
  if (!raw) {
    return 50;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new AppError('limit must be a valid integer.', {
      code: 'INVALID_QUERY_PARAMETER',
      statusCode: 400,
    });
  }

  return Math.max(1, Math.min(parsed, 100));
};

const parseSessionModelPayload = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const model = readOptionalQueryString(body.model);
  if (!model) {
    throw new AppError('model is required.', {
      code: 'MODEL_REQUIRED',
      statusCode: 400,
    });
  }

  return model;
};

router.use(createProviderSelectionCatalogRouter());

router.get(
  '/:provider/auth/status',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const status = await providerAuthService.getProviderAuthStatus(provider, {
      forceRefresh: req.query.force === '1' || req.query.force === 'true',
    });
    if (isProfileProvider(provider) && status.installed && !status.authenticated) {
      const userId = readAuthenticatedUserId(req);
      if (providerProfilesDb.countActiveProviderProfiles(userId, provider) > 0) {
        res.json(createApiSuccessResponse({
          ...status,
          authenticated: true,
          email: 'Configured profile',
          method: 'custom_provider',
          error: undefined,
        }));
        return;
      }
    }
    res.json(createApiSuccessResponse(status));
  }),
);

router.get(
  '/:provider/profiles',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProfileProvider(req.params.provider);

    const userId = readAuthenticatedUserId(req);
    res.json(createApiSuccessResponse({
      provider,
      profiles: providerProfilesDb.listProviderProfiles(userId, provider),
    }));
  }),
);

router.post(
  '/:provider/profiles',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProfileProvider(req.params.provider);

    const userId = readAuthenticatedUserId(req);
    const profile = providerProfilesDb.createProviderProfile(
      userId,
      provider,
      parseProviderProfileCreatePayload(provider, req.body),
    );
    res.status(201).json(createApiSuccessResponse({ provider, profile }));
  }),
);

router.patch(
  '/:provider/profiles/:profileId',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProfileProvider(req.params.provider);

    const userId = readAuthenticatedUserId(req);
    const profileId = parseProviderProfileId(req.params.profileId);
    const profile = providerProfilesDb.updateProviderProfile(
      userId,
      provider,
      profileId,
      parseProviderProfileUpdatePayload(provider, req.body),
    );
    if (!profile) {
      throw new AppError('Provider profile not found.', {
        code: 'PROVIDER_PROFILE_NOT_FOUND',
        statusCode: 404,
      });
    }

    res.json(createApiSuccessResponse({ provider, profile }));
  }),
);

router.delete(
  '/:provider/profiles/:profileId',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProfileProvider(req.params.provider);

    const userId = readAuthenticatedUserId(req);
    const profileId = parseProviderProfileId(req.params.profileId);
    if (!providerProfilesDb.deleteProviderProfile(userId, provider, profileId)) {
      throw new AppError('Provider profile not found.', {
        code: 'PROVIDER_PROFILE_NOT_FOUND',
        statusCode: 404,
      });
    }

    res.json(createApiSuccessResponse({ provider, deleted: true }));
  }),
);

router.get(
  '/:provider/models',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const bypassCache = parseOptionalBooleanQuery(req.query.bypassCache, 'bypassCache') ?? false;
    const result = await providerModelsService.getProviderModels(provider, { bypassCache });
    res.json(createApiSuccessResponse({ provider, models: result.models, cache: result.cache }));
  }),
);

/**
 * Reports which model one session is using. `requestedModel` lets the client
 * pass the default it would otherwise send, so a session that has not been
 * sent on yet resolves to that instead of the catalog default.
 */
router.get(
  '/:provider/sessions/:sessionId/active-model',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = parseSessionId(req.params.sessionId);
    const requestedModel = readOptionalQueryString(req.query.requestedModel);
    const result = await providerModelsService.resolveSessionModel(provider, {
      sessionId,
      requestedModel,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/:provider/sessions/:sessionId/active-model',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = parseSessionId(req.params.sessionId);
    const model = parseSessionModelPayload(req.body);
    const stored = providerModelsService.setSessionModel(provider, sessionId, model);
    // A session row only exists once the gateway has allocated one. Report the
    // selection back either way so the client can hold it until the first send.
    res.json(createApiSuccessResponse(
      stored ?? { provider, sessionId, model, source: 'session' as const },
    ));
  }),
);

// ----------------- Skills routes -----------------
router.get(
  '/:provider/skills',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const skills = await providerSkillsService.listProviderSkills(provider, { workspacePath });
    res.json(createApiSuccessResponse({ provider, skills }));
  }),
);

router.post(
  '/:provider/skills',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const input = parseProviderSkillCreatePayload(req.body);
    const skills = await providerSkillsService.addProviderSkills(provider, input);
    res.json(createApiSuccessResponse({ provider, skills }));
  }),
);

router.delete(
  '/:provider/skills/:directoryName',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const result = await providerSkillsService.removeProviderSkill(provider, {
      directoryName: readPathParam(req.params.directoryName, 'directoryName'),
    });
    res.json(createApiSuccessResponse(result));
  }),
);

// ----------------- MCP routes -----------------
router.get(
  '/:provider/mcp/servers',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const scope = parseMcpScope(req.query.scope);

    if (scope) {
      const servers = await providerMcpService.listProviderMcpServersForScope(provider, scope, { workspacePath });
      res.json(createApiSuccessResponse({ provider, scope, servers }));
      return;
    }

    const groupedServers = await providerMcpService.listProviderMcpServers(provider, { workspacePath });
    res.json(createApiSuccessResponse({ provider, scopes: groupedServers }));
  }),
);

router.post(
  '/:provider/mcp/servers',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const payload = parseMcpUpsertPayload(req.body);
    const server = await providerMcpService.upsertProviderMcpServer(provider, payload);
    res.status(201).json(createApiSuccessResponse({ server }));
  }),
);

router.delete(
  '/:provider/mcp/servers/:name',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const scope = parseMcpScope(req.query.scope);
    const workspacePath = readOptionalQueryString(req.query.workspacePath);
    const result = await providerMcpService.removeProviderMcpServer(provider, {
      name: readPathParam(req.params.name, 'name'),
      scope,
      workspacePath,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/mcp/servers/global',
  asyncHandler(async (req: Request, res: Response) => {
    const payload = parseMcpUpsertPayload(req.body);
    if (payload.scope === 'local') {
      throw new AppError('Global MCP add supports only "user" or "project" scopes.', {
        code: 'INVALID_GLOBAL_MCP_SCOPE',
        statusCode: 400,
      });
    }

    const results = await providerMcpService.addMcpServerToAllProviders({
      ...payload,
      scope: payload.scope === 'user' ? 'user' : 'project',
    });
    res.status(201).json(createApiSuccessResponse({ results }));
  }),
);

router.get(
  '/capabilities',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(createApiSuccessResponse({
      providers: providerCapabilitiesService.listAllProviderCapabilities(),
    }));
  }),
);

router.get(
  '/:provider/capabilities',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    res.json(createApiSuccessResponse(
      providerCapabilitiesService.getProviderCapabilities(provider),
    ));
  }),
);

// ----------------- Session routes -----------------
/**
 * Session gateway entry point: allocates the stable app-facing session id for
 * a brand-new chat. The frontend must call this before the first `chat.send`
 * so the session id in the URL, the store, and the websocket all agree from
 * the very first message — there is no client-visible session-id handoff.
 *
 * The public contract is the complete selection and every field is required:
 * { provider, providerProfileId, model, projectPath }. Full validation runs
 * first; only then is one fully-configured session row created — no
 * half-configured session is ever returned on success.
 */
router.post(
  '/sessions',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const provider = parseProvider(body.provider);
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
    const providerProfileId = parseRequiredProviderProfileId(body);
    const model = readOptionalBodyString(body, 'model') ?? '';

    const userId = readAuthenticatedUserId(req);
    await providerSelectionService.validateSelection({
      userId,
      provider,
      providerProfileId,
      model,
    });

    const result = sessionsService.createAppSession(provider, projectPath, {
      providerProfileId,
      model,
    });
    res.status(201).json(createApiSuccessResponse(result));
  }),
);

/**
 * Forks one session: starts a fresh sibling chat in the same project. The
 * complete target selection { provider, providerProfileId, model } is required
 * in the body — a fork is only created against a fully valid selection, which
 * is also the supported continuation path for legacy sessions (e.g. Claude
 * Local CLI rows that can no longer be sent on directly). `carryContext`
 * defaults to true; an explicit false opts out of generating a handoff summary.
 */
router.post(
  '/sessions/:sessionId/fork',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const provider = parseProvider(body.provider);
    const providerProfileId = parseRequiredProviderProfileId(body);
    const model = readOptionalBodyString(body, 'model') ?? '';
    const carryContext = body.carryContext !== false;
    const userId = readAuthenticatedUserId(req);

    await providerSelectionService.validateSelection({
      userId,
      provider,
      providerProfileId,
      model,
    });

    const result = await sessionsService.forkSession(sessionId, {
      provider,
      providerProfileId,
      model,
      carryContext,
      userId,
    });
    res.status(201).json(createApiSuccessResponse(result));
  }),
);

router.get(
  '/sessions/running',
  asyncHandler(async (_req: Request, res: Response) => {
    const sessions = sessionsService.listRunningSessions();
    res.json(createApiSuccessResponse({ sessions }));
  }),
);

router.get(
  '/sessions/archived',
  asyncHandler(async (_req: Request, res: Response) => {
    const sessions = sessionsService.listArchivedSessions();
    res.json(createApiSuccessResponse({ sessions }));
  }),
);

router.get(
  '/sessions/:sessionId/subagents',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const subagents = await sessionsService.listSubagents(sessionId);
    res.json(createApiSuccessResponse({ subagents }));
  }),
);

router.get(
  '/sessions/:sessionId/provider-id',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const providerSessionId = sessionsService.getProviderSessionId(sessionId);
    res.json(createApiSuccessResponse({ sessionId: providerSessionId }));
  }),
);

router.get(
  '/sessions/:sessionId/token-usage',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = await providerTokenUsageService.getSessionTokenUsage(sessionId);
    res.json(createApiSuccessResponse(result));
  }),
);

// Must stay registered after the static and session-specific routes so their
// literals never match the generic `:sessionId` parameter.
//
// The payload is a superset: the flat detail fields resolve the owning project
// for deep links, and `session` carries the sub-agent / provider-profile
// context. `getSessionDetailsById` also accepts a provider-native alias id, so
// the context is looked up with the canonical id it resolves to.
router.get(
  '/sessions/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const details = sessionsService.getSessionDetailsById(sessionId);
    res.json(createApiSuccessResponse({
      ...details,
      session: sessionsService.getSessionContext(details.sessionId),
    }));
  }),
);

router.delete(
  '/sessions/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const force = parseOptionalBooleanQuery(req.query.force, 'force') ?? false;
    const deletedFromDisk = parseOptionalBooleanQuery(req.query.deletedFromDisk, 'deletedFromDisk') ?? force;
    const result = await sessionsService.deleteOrArchiveSessionById(sessionId, {
      force,
      deletedFromDisk,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/sessions/:sessionId/restore',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const result = sessionsService.restoreSessionById(sessionId);
    res.json(createApiSuccessResponse(result));
  }),
);

router.put(
  '/sessions/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const summary = parseSessionRenameSummary(req.body);
    const result = sessionsService.renameSessionById(sessionId, summary);
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/sessions/:sessionId/rewind/preview',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
    if (!messageId) {
      throw new AppError('messageId is required.', {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }

    const result = await sessionRewindService.preview(
      sessionId,
      messageId,
      resolveSessionProviderProfile(req, sessionId),
    );
    res.json(createApiSuccessResponse(result));
  }),
);

router.post(
  '/sessions/:sessionId/rewind',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
    if (!messageId) {
      throw new AppError('messageId is required.', {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }

    const result = await sessionRewindService.rewind(sessionId, {
      messageId,
      mode: parseSessionRewindMode(body.mode),
      providerProfile: resolveSessionProviderProfile(req, sessionId),
    });
    res.json(createApiSuccessResponse(result));
  }),
);

router.patch(
  '/sessions/:sessionId/messages/:messageId',
  asyncHandler(async (req: Request) => {
    parseSessionId(req.params.sessionId);
    const messageId = typeof req.params.messageId === 'string' ? req.params.messageId.trim() : '';
    if (!messageId) {
      throw new AppError('messageId is required.', {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }
    // PATCH + a later WebSocket send cannot be atomic because both supported
    // providers allocate a fork id only after their external side effect.
    // Reject before profile lookup, fork creation, DB mutation, or broadcast.
    throw new AppError(
      'Transactional edit and resubmit is unavailable. Copy the message to the composer instead.',
      {
        code: 'TRANSACTIONAL_EDIT_UNAVAILABLE',
        statusCode: 409,
      },
    );
  }),
);

router.get(
  '/sessions/:sessionId/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const limitRaw = readOptionalQueryString(req.query.limit);
    const offsetRaw = readOptionalQueryString(req.query.offset);

    let limit: number | null = null;
    if (limitRaw !== undefined) {
      const parsedLimit = Number.parseInt(limitRaw, 10);
      if (Number.isNaN(parsedLimit) || parsedLimit < 0) {
        throw new AppError('limit must be a non-negative integer.', {
          code: 'INVALID_QUERY_PARAMETER',
          statusCode: 400,
        });
      }
      limit = parsedLimit;
    }

    let offset = 0;
    if (offsetRaw !== undefined) {
      const parsedOffset = Number.parseInt(offsetRaw, 10);
      if (Number.isNaN(parsedOffset) || parsedOffset < 0) {
        throw new AppError('offset must be a non-negative integer.', {
          code: 'INVALID_QUERY_PARAMETER',
          statusCode: 400,
        });
      }
      offset = parsedOffset;
    }

    const result = await sessionsService.fetchHistory(sessionId, {
      limit,
      offset,
    });
    res.json(createApiSuccessResponse(result));
  }),
);

router.get(
  '/sessions/:sessionId/export',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const rawFormat =
      typeof req.query.format === 'string' ? req.query.format.trim().toLowerCase() : '';
    const format: 'zip' | 'md' = rawFormat === 'md' ? 'md' : 'zip';
    const expectedTranscriptDigest = readOptionalQueryString(req.query.expectedDigest)?.trim().toLowerCase() ?? '';

    const result = await sessionExportService.exportSession(
      sessionId,
      format,
      expectedTranscriptDigest,
    );
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${sessionExportService.sanitizeFilename(result.filename)}"`);
    res.setHeader('Content-Length', String(result.buffer.length));
    res.send(result.buffer);
  }),
);

router.get('/search/sessions', asyncHandler(async (req: Request, res: Response) => {
  const query = parseSessionSearchQuery(req.query.q);
  const limit = parseSessionSearchLimit(req.query.limit);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  const abortController = new AbortController();
  req.on('close', () => {
    closed = true;
    abortController.abort();
  });

  try {
    await sessionConversationsSearchService.search({
      query,
      limit,
      signal: abortController.signal,
      onProgress: ({ projectResult, totalMatches, scannedProjects, totalProjects }) => {
        if (closed) {
          return;
        }

        if (projectResult) {
          res.write(`event: result\ndata: ${JSON.stringify({ projectResult, totalMatches, scannedProjects, totalProjects })}\n\n`);
          return;
        }

        res.write(`event: progress\ndata: ${JSON.stringify({ totalMatches, scannedProjects, totalProjects })}\n\n`);
      },
    });

    if (!closed) {
      res.write('event: done\ndata: {}\n\n');
    }
  } catch (error) {
    console.error('Error searching conversations:', error);
    if (!closed) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Search failed' })}\n\n`);
    }
  } finally {
    if (!closed) {
      res.end();
    }
  }
}));

export default router;
