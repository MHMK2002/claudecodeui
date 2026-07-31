import express, { type Request, type Response } from 'express';

import { providerProfilesDb } from '@/modules/database/index.js';
import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { providerMcpService } from '@/modules/providers/services/mcp.service.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { providerSkillsService } from '@/modules/providers/services/skills.service.js';
import { sessionConversationsSearchService } from '@/modules/providers/services/session-conversations-search.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type {
  LLMProvider,
  ClaudeProviderProfileAuthType,
  McpScope,
  McpTransport,
  ProviderChangeActiveModelInput,
  ProviderSkillCreateFile,
  ProviderSkillCreateInput,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

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

type AuthenticatedProviderRequest = Request & {
  user?: {
    id?: unknown;
    userId?: unknown;
  };
};

const readAuthenticatedUserId = (req: Request): number => {
  const user = (req as AuthenticatedProviderRequest).user;
  const rawUserId = user?.id ?? user?.userId;
  const parsed = typeof rawUserId === 'number'
    ? rawUserId
    : typeof rawUserId === 'string'
      ? (/^\d+$/.test(rawUserId.trim()) ? Number(rawUserId.trim()) : NaN)
      : NaN;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError('Authenticated user is required.', {
      code: 'AUTHENTICATED_USER_REQUIRED',
      statusCode: 401,
    });
  }

  return parsed;
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

const parseClaudeProfileAuthType = (value: unknown): ClaudeProviderProfileAuthType => {
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

const parseClaudeProfileBaseUrl = (value: string | undefined): string | null | undefined => {
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

const readClaudeProfileSecret = (body: Record<string, unknown>): string | undefined => (
  readOptionalBodyString(body, 'secretValue')
  ?? readOptionalBodyString(body, 'token')
  ?? readOptionalBodyString(body, 'secret')
);

const parseClaudeProfileCreatePayload = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const title = readOptionalBodyString(body, 'title');
  const secretValue = readClaudeProfileSecret(body);
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

  return {
    title,
    baseUrl: parseClaudeProfileBaseUrl(readOptionalBodyString(body, 'baseUrl')) ?? null,
    authType: parseClaudeProfileAuthType(body.authType),
    secretValue,
    isDefault: body.isDefault === true,
    isActive: body.isActive !== false,
  };
};

const parseClaudeProfileUpdatePayload = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const title = readOptionalBodyString(body, 'title');
  const baseUrl = parseClaudeProfileBaseUrl(readOptionalBodyString(body, 'baseUrl'));
  const secretValue = readClaudeProfileSecret(body);

  if (title !== undefined && !title) {
    throw new AppError('title must not be empty.', {
      code: 'PROVIDER_PROFILE_TITLE_REQUIRED',
      statusCode: 400,
    });
  }

  return {
    ...(title !== undefined ? { title } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(body.authType !== undefined ? { authType: parseClaudeProfileAuthType(body.authType) } : {}),
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

const parseChangeActiveModelPayload = (payload: unknown): ProviderChangeActiveModelInput => {
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

  return {
    sessionId: '',
    model,
  };
};

router.get(
  '/:provider/auth/status',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const status = await providerAuthService.getProviderAuthStatus(provider);
    if (provider === 'claude' && status.installed && !status.authenticated) {
      const userId = readAuthenticatedUserId(req);
      if (providerProfilesDb.countActiveClaudeProfiles(userId) > 0) {
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
    const provider = parseProvider(req.params.provider);
    if (provider !== 'claude') {
      throw new AppError('Provider profiles are currently supported for Claude only.', {
        code: 'PROVIDER_PROFILES_UNSUPPORTED',
        statusCode: 404,
      });
    }

    const userId = readAuthenticatedUserId(req);
    res.json(createApiSuccessResponse({
      provider,
      profiles: providerProfilesDb.listClaudeProfiles(userId),
    }));
  }),
);

router.post(
  '/:provider/profiles',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    if (provider !== 'claude') {
      throw new AppError('Provider profiles are currently supported for Claude only.', {
        code: 'PROVIDER_PROFILES_UNSUPPORTED',
        statusCode: 404,
      });
    }

    const userId = readAuthenticatedUserId(req);
    const profile = providerProfilesDb.createClaudeProfile(
      userId,
      parseClaudeProfileCreatePayload(req.body),
    );
    res.status(201).json(createApiSuccessResponse({ provider, profile }));
  }),
);

router.patch(
  '/:provider/profiles/:profileId',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    if (provider !== 'claude') {
      throw new AppError('Provider profiles are currently supported for Claude only.', {
        code: 'PROVIDER_PROFILES_UNSUPPORTED',
        statusCode: 404,
      });
    }

    const userId = readAuthenticatedUserId(req);
    const profileId = parseProviderProfileId(req.params.profileId);
    const profile = providerProfilesDb.updateClaudeProfile(
      userId,
      profileId,
      parseClaudeProfileUpdatePayload(req.body),
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
    const provider = parseProvider(req.params.provider);
    if (provider !== 'claude') {
      throw new AppError('Provider profiles are currently supported for Claude only.', {
        code: 'PROVIDER_PROFILES_UNSUPPORTED',
        statusCode: 404,
      });
    }

    const userId = readAuthenticatedUserId(req);
    const profileId = parseProviderProfileId(req.params.profileId);
    if (!providerProfilesDb.deleteClaudeProfile(userId, profileId)) {
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

router.post(
  '/:provider/sessions/:sessionId/active-model',
  asyncHandler(async (req: Request, res: Response) => {
    const provider = parseProvider(req.params.provider);
    const sessionId = parseSessionId(req.params.sessionId);
    const payload = parseChangeActiveModelPayload(req.body);
    const result = await providerModelsService.changeActiveModel(provider, {
      ...payload,
      sessionId,
    });
    res.json(createApiSuccessResponse(result));
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
 */
router.post(
  '/sessions',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const provider = parseProvider(body.provider);
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
    const providerProfileId = parseOptionalProviderProfileId(body.providerProfileId);
    if (providerProfileId !== null && provider !== 'claude') {
      throw new AppError('providerProfileId is currently supported for Claude sessions only.', {
        code: 'PROVIDER_PROFILE_UNSUPPORTED',
        statusCode: 400,
      });
    }

    if (providerProfileId !== null) {
      const userId = readAuthenticatedUserId(req);
      const profile = providerProfilesDb.getClaudeProfileForRuntime(userId, providerProfileId);
      if (!profile) {
        throw new AppError('Provider profile not found or inactive.', {
          code: 'PROVIDER_PROFILE_NOT_FOUND',
          statusCode: 404,
        });
      }
    }

    const result = sessionsService.createAppSession(provider, projectPath, { providerProfileId });
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

    const keepMessage = body.keepMessage === undefined
      ? true
      : body.keepMessage === true || body.keepMessage === 'true';

    const result = await sessionsService.rewindSession(sessionId, { messageId, keepMessage });
    res.json(createApiSuccessResponse(result));
  }),
);

router.patch(
  '/sessions/:sessionId/messages/:messageId',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = parseSessionId(req.params.sessionId);
    const messageId = typeof req.params.messageId === 'string' ? req.params.messageId.trim() : '';
    if (!messageId) {
      throw new AppError('messageId is required.', {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const content = typeof body.content === 'string' ? body.content : '';
    if (!content.trim()) {
      throw new AppError('content is required.', {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }
    const images = Array.isArray(body.images) ? (body.images as unknown[]) : [];
    const result = await sessionsService.editUserMessage(sessionId, {
      messageId,
      content,
      images,
    });
    res.json(createApiSuccessResponse(result));
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
