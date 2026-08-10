import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { forkContextService } from '@/modules/providers/services/fork-context.service.js';
import { parseAgentTools } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type CreateAppSessionResult = {
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
  providerProfileId: number | null;
  /** Whether a handoff summary from the source session was stored on this fork. */
  forkContextCarried: boolean;
};

type SessionContext = {
  sessionId: string;
  provider: LLMProvider;
  providerProfileId: number | null;
  projectId: string | null;
  projectPath: string | null;
  title: string;
  parentSessionId: string | null;
  agentType: string | null;
  isSubagent: boolean;
  /** Carried-over handoff summary, present until the first chat.send consumes it. */
  forkContext: string | null;
  forkContextConsumed: boolean;
};

type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  providerProfileId: number | null;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
};

type SubagentStatus = 'running' | 'completed' | 'unknown';

type SubagentCurrentTool = {
  toolName: string;
  toolInput: unknown;
};

type SubagentListItem = {
  sessionId: string;
  provider: LLMProvider;
  parentSessionId: string;
  name: string;
  agentType: string | null;
  status: SubagentStatus;
  toolCount: number;
  currentTool: SubagentCurrentTool | null;
  totalTokens: number | null;
  totalDurationMs: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ClaudeAgentResult = {
  agentType: string | null;
  description: string | null;
  status: string | null;
  totalTokens: number | null;
  totalDurationMs: number | null;
  totalToolUseCount: number | null;
};

type ClaudeAgentActivity = {
  toolCount: number;
  currentTool: SubagentCurrentTool | null;
  // null when the transcript could not be read at all.
  isComplete: boolean | null;
};

function readOptionalNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Collects the per-agent results Claude records on the parent transcript when
 * an agent-spawning tool call returns, keyed by agent id.
 *
 * Background agents (`status: "async_launched"`) return before the agent has
 * done anything, so their result carries no `agentType` and no totals. The
 * spawning tool call's own input does carry both the agent type and a short
 * description, so tool inputs are indexed by id and joined back through the
 * `tool_use_id` on the result row.
 */
async function readClaudeAgentResults(parentJsonlPath: string): Promise<Map<string, ClaudeAgentResult>> {
  const results = new Map<string, ClaudeAgentResult>();
  const toolInputsById = new Map<string, Record<string, unknown>>();

  try {
    const fileStream = fs.createReadStream(parentJsonlPath);
    const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of lineReader) {
      if (!line.trim()) {
        continue;
      }

      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // Concurrent writes can leave a partial trailing line.
        continue;
      }

      const message = entry.message as Record<string, unknown> | undefined;
      const contentParts = Array.isArray(message?.content)
        ? (message.content as Array<Record<string, unknown>>)
        : [];

      for (const part of contentParts) {
        if (part.type === 'tool_use' && typeof part.id === 'string') {
          toolInputsById.set(part.id, (part.input as Record<string, unknown>) ?? {});
        }
      }

      const toolUseResult = entry.toolUseResult as Record<string, unknown> | undefined;
      const agentId = typeof toolUseResult?.agentId === 'string' ? toolUseResult.agentId : null;
      if (!agentId) {
        continue;
      }

      const toolUseId = contentParts.find((part) => part.type === 'tool_result')?.tool_use_id;
      const spawnInput = typeof toolUseId === 'string' ? toolInputsById.get(toolUseId) ?? {} : {};

      results.set(agentId, {
        agentType: typeof toolUseResult?.agentType === 'string'
          ? toolUseResult.agentType
          : typeof spawnInput.subagent_type === 'string'
            ? spawnInput.subagent_type
            : null,
        description: typeof spawnInput.description === 'string' ? spawnInput.description : null,
        status: typeof toolUseResult?.status === 'string' ? toolUseResult.status : null,
        totalTokens: readOptionalNumber(toolUseResult?.totalTokens),
        totalDurationMs: readOptionalNumber(toolUseResult?.totalDurationMs),
        totalToolUseCount: readOptionalNumber(toolUseResult?.totalToolUseCount),
      });
    }
  } catch {
    // A missing or unreadable parent transcript just means no enrichment.
  }

  return results;
}

/**
 * Reads live tool activity straight from one agent transcript.
 *
 * The transcript is the only source that stays current while the agent runs —
 * the parent records nothing until the spawning tool call returns. A trailing
 * tool call with no result yet is what the agent is doing right now.
 */
async function readClaudeAgentActivity(agentJsonlPath: string): Promise<ClaudeAgentActivity> {
  try {
    const tools = await parseAgentTools(agentJsonlPath);
    const lastTool = tools.at(-1);
    const isRunningTool = Boolean(lastTool) && lastTool?.toolResult === undefined;

    return {
      toolCount: tools.length,
      currentTool: isRunningTool && lastTool
        ? { toolName: String(lastTool.toolName ?? ''), toolInput: lastTool.toolInput ?? null }
        : null,
      isComplete: !isRunningTool,
    };
  } catch {
    return { toolCount: 0, currentTool: null, isComplete: null };
  }
}

/**
 * A recorded parent result is authoritative — it only exists once the agent
 * finished. Otherwise the agent transcript decides: an unresolved trailing
 * tool call means it is still working.
 */
function resolveSubagentStatus(
  parentResult: ClaudeAgentResult | null,
  isComplete: boolean | null,
): SubagentStatus {
  if (parentResult?.status === 'completed') {
    return 'completed';
  }

  if (isComplete === null) {
    return 'unknown';
  }

  return isComplete ? 'completed' : 'running';
}

type SessionDetails = {
  /** Canonical app-facing session id (may differ from the looked-up id when a provider-native id was given). */
  sessionId: string;
  provider: LLMProvider;
  summary: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isArchived: boolean;
  project: {
    projectId: string;
    path: string;
    fullPath: string;
    displayName: string;
    isStarred: boolean;
    isArchived: boolean;
  } | null;
};

/**
 * Removes one file if it exists.
 */
async function removeFileIfExists(filePath: string): Promise<boolean> {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Archive rows need a stable project label even when the owning project is not
 * part of the active sidebar payload. This lightweight resolver keeps the
 * archive API self-contained while still matching the project's stored display
 * name when one exists.
 */
function resolveProjectDisplayName(
  projectPath: string | null,
  customProjectName: string | null | undefined,
): string {
  const trimmedCustomName = typeof customProjectName === 'string' ? customProjectName.trim() : '';
  if (trimmedCustomName.length > 0) {
    return trimmedCustomName;
  }

  if (!projectPath) {
    return 'Unknown Project';
  }

  return path.basename(projectPath) || projectPath;
}

/**
 * Application service for provider-backed session message operations.
 *
 * Callers pass a provider id and this service resolves the concrete provider
 * class, keeping normalization/history call sites decoupled from implementation
 * file layout.
 */
export const sessionsService = {
  /**
   * Lists provider ids that can load session history and normalize live messages.
   */
  listProviderIds(): LLMProvider[] {
    return providerRegistry.listProviders().map((provider) => provider.id);
  },

  /**
   * Returns app-facing ids for provider runs that are currently processing.
   *
   * This is intentionally status-only: callers that only need sidebar activity
   * indicators should not attach to chat streams or request replayed messages.
   */
  listRunningSessions(): Array<{
    sessionId: string;
    provider: LLMProvider;
    startedAt: number;
    lastSeq: number;
  }> {
    return chatRunRegistry.listRunningRuns();
  },

  /**
   * Resolves the provider-native session id a runtime needs for resume.
   *
   * Callers hand provider runtimes the stable app session id; the provider
   * CLIs/SDKs only understand their own native id, which lives on the session
   * row. Ids without a row are assumed to be provider-native already (direct
   * API callers that reference sessions the watcher has not indexed yet).
   */
  resolveProviderSessionId(sessionId: string | null | undefined): string | null {
    if (!sessionId) {
      return null;
    }

    const session = sessionsDb.getSessionById(sessionId);
    return session ? session.provider_session_id : sessionId;
  },

  /**
   * Normalizes one provider-native event into frontend session message events.
   */
  normalizeMessage(
    providerName: string,
    raw: unknown,
    sessionId: string | null,
  ): NormalizedMessage[] {
    return providerRegistry.resolveProvider(providerName).sessions.normalizeMessage(raw, sessionId);
  },

  /**
   * Allocates a stable app-facing session id before any provider run happens.
   *
   * This is the entry point of the session gateway: the frontend calls this
   * (via `POST /api/providers/sessions`) when the user starts a brand-new
   * chat, navigates to the returned id immediately, and the id never changes
   * for the lifetime of the conversation. The provider-native id is mapped to
   * this row later, when the provider runtime announces it mid-run.
   */
  createAppSession(
    provider: LLMProvider,
    projectPath: string,
    options: { providerProfileId?: number | null } = {},
  ): CreateAppSessionResult {
    const normalizedProjectPath = projectPath.trim();
    if (!normalizedProjectPath) {
      throw new AppError('projectPath is required.', {
        code: 'PROJECT_PATH_REQUIRED',
        statusCode: 400,
      });
    }

    const sessionId = randomUUID();
    const providerProfileId = options.providerProfileId ?? null;
    sessionsDb.createAppSession(sessionId, provider, normalizedProjectPath, providerProfileId);

    return {
      sessionId,
      provider,
      projectPath: normalizedProjectPath,
      providerProfileId,
      forkContextCarried: false,
    };
  },

  /**
   * Starts a fresh sibling chat ("fork") in the same project, inheriting the
   * source session's provider and active profile. The new row is a brand-new
   * conversation — no transcript is cloned — and is returned so the caller can
   * navigate to it immediately. When `carryContext` is set (default true) and the
   * source has history, a short handoff summary is generated and stored on the
   * new row; the chat gateway prepends it to the forked session's first message
   * only, so a cross-provider fork (e.g. Claude → Codex) keeps its context.
   *
   * Refuses to fork when the source is itself a sub-agent row: those sessions
   * carry `parent_session_id`, have no own transcript to fork from, and would
   * otherwise leak a child session outside the agent tree.
   */
  async forkSession(
    sourceSessionId: string,
    options: {
      provider?: LLMProvider;
      providerProfileId?: number | null;
      carryContext?: boolean;
      userId?: number | null;
    } = {},
  ): Promise<CreateAppSessionResult> {
    const source = sessionsDb.getSessionById(sourceSessionId);
    if (!source) {
      throw new AppError(`Session "${sourceSessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (source.parent_session_id) {
      throw new AppError(
        'Cannot fork a sub-agent transcript; fork its parent session instead.',
        { code: 'SESSION_FORK_NOT_ALLOWED', statusCode: 400 },
      );
    }

    const inheritedProvider = (source.provider ?? '') as LLMProvider;
    const provider = options.provider ?? inheritedProvider;
    if (!provider || !providerRegistry.resolveProvider(provider)) {
      throw new AppError(
        `Cannot fork: provider "${provider || 'unknown'}" is not supported.`,
        { code: 'PROVIDER_UNSUPPORTED', statusCode: 400 },
      );
    }

    const projectPath = source.project_path ?? '';
    if (!projectPath) {
      throw new AppError('Cannot fork: source session has no project path.', {
        code: 'SESSION_FORK_NOT_ALLOWED',
        statusCode: 400,
      });
    }

    // When the caller doesn't pass providerProfileId we inherit the source's
    // profile (null if the source was on Local CLI). Explicit null means
    // "force Local CLI on the forked session".
    const providerProfileId = options.providerProfileId === undefined
      ? (source.provider_profile_id ?? null)
      : options.providerProfileId;
    const created = this.createAppSession(provider, projectPath, { providerProfileId });

    // Optionally condense the source session's history into a handoff summary
    // and store it on the new row. The summary step never throws — it degrades
    // to a transcript or null — so a fork cannot fail because of it.
    const carryContext = options.carryContext !== false;
    if (carryContext) {
      try {
        const history = await this.fetchHistory(sourceSessionId, { limit: 60 });
        const summary = await forkContextService.buildForkContext({
          messages: history.messages,
          sourceProvider: (source.provider ?? '') as LLMProvider,
          sourceProviderProfileId: source.provider_profile_id ?? null,
          projectPath: source.project_path ?? null,
          userId: options.userId ?? null,
        });
        if (summary) {
          sessionsDb.setForkContext(created.sessionId, summary);
          return { ...created, forkContextCarried: true };
        }
      } catch (error) {
        console.warn(
          `[forkSession] Carrying context for "${sourceSessionId}" failed; continuing without it:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    return created;
  },

  /**
   * Resolves the canonical application identity behind one persisted
   * transcript id. Sub-agent rows are returned as children of their root
   * session so callers can redirect legacy `/session/<agent-id>` links to the
   * parent-scoped route instead of selecting the transcript as a session.
   */
  getSessionContext(sessionId: string): SessionContext {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const projectPath = session.project_path ?? null;
    const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;

    return {
      sessionId: session.session_id,
      provider: session.provider as LLMProvider,
      providerProfileId: session.provider_profile_id ?? null,
      projectId: project?.project_id ?? null,
      projectPath,
      title: session.custom_name?.trim() || 'Untitled Session',
      parentSessionId: session.parent_session_id ?? null,
      agentType: session.agent_type ?? null,
      isSubagent: Boolean(session.parent_session_id),
      forkContext: session.fork_context ?? null,
      forkContextConsumed: Boolean(session.fork_context_consumed),
    };
  },

  /**
   * Resolves the provider-native id only for an explicit user copy action.
   * Normal session payloads continue to expose only the stable app id.
   */
  getProviderSessionId(sessionId: string): string {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!session.provider_session_id) {
      throw new AppError('This session ID is not available yet.', {
        code: 'PROVIDER_SESSION_ID_NOT_AVAILABLE',
        statusCode: 409,
      });
    }

    return session.provider_session_id;
  },

  /**
   * Fetches persisted history by app session id.
   *
   * Provider and provider-specific lookup hints are resolved from the indexed
   * session metadata in the database. The provider adapter receives the
   * provider-native session id (the one written into transcripts on disk),
   * and every returned message is remapped back to the app session id so
   * provider ids never reach the frontend.
   */
  async fetchHistory(
    sessionId: string,
    options: Pick<FetchHistoryOptions, 'limit' | 'offset'> = {},
  ): Promise<FetchHistoryResult> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    // App-created sessions that never produced a provider transcript yet
    // (e.g. first message still streaming) simply have no history.
    if (!session.provider_session_id) {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset: options.offset ?? 0,
        limit: options.limit ?? null,
      };
    }

    const provider = session.provider as LLMProvider;
    const result = await providerRegistry.resolveProvider(provider).sessions.fetchHistory(sessionId, {
      limit: options.limit ?? null,
      offset: options.offset ?? 0,
      projectPath: session.project_path ?? '',
      providerSessionId: session.provider_session_id,
    });

    return {
      ...result,
      messages: result.messages.map((message) => ({
        ...message,
        sessionId,
      })),
    };
  },

  /**
   * Lists the sub-agents one session spawned, for the sidebar's third tree level.
   *
   * Each entry identifies a parent-scoped transcript. The persistence layer
   * still stores a child row so the shared history reader can load it, but the
   * frontend must not promote that row to an independently selected session.
   *
   * Claude entries carry live tool activity parsed from the agent transcript;
   * Codex entries currently expose metadata only (its rollouts use a different
   * record format that the tool parser does not read).
   */
  async listSubagents(parentSessionId: string): Promise<SubagentListItem[]> {
    const parentSession = sessionsDb.getSessionById(parentSessionId);
    if (!parentSession) {
      throw new AppError(`Session "${parentSessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const agentRows = sessionsDb.getSubagentsByParentSessionId(parentSessionId);
    if (agentRows.length === 0) {
      return [];
    }

    // Token/duration totals and the resolved agent type are only recorded on
    // the parent side, once the spawning tool call returns.
    const parentResults = parentSession.provider === 'claude' && parentSession.jsonl_path
      ? await readClaudeAgentResults(parentSession.jsonl_path)
      : new Map<string, ClaudeAgentResult>();

    return Promise.all(agentRows.map(async (row) => {
      const parentResult = parentResults.get(row.session_id) ?? null;
      const activity = row.provider === 'claude' && row.jsonl_path
        ? await readClaudeAgentActivity(row.jsonl_path)
        : { toolCount: 0, currentTool: null, isComplete: null };

      return {
        sessionId: row.session_id,
        provider: row.provider as LLMProvider,
        parentSessionId,
        // The spawn description is written for a human; the stored name falls
        // back to the raw prompt, which is often identical across sibling agents.
        name: parentResult?.description?.trim() || row.custom_name?.trim() || row.session_id,
        agentType: parentResult?.agentType ?? row.agent_type ?? null,
        status: resolveSubagentStatus(parentResult, activity.isComplete),
        toolCount: parentResult?.totalToolUseCount ?? activity.toolCount,
        currentTool: activity.currentTool,
        totalTokens: parentResult?.totalTokens ?? null,
        totalDurationMs: parentResult?.totalDurationMs ?? null,
        createdAt: row.created_at ?? null,
        updatedAt: row.updated_at ?? null,
      };
    }));
  },

  /**
   * Resolves one session (by app id, falling back to the provider-native id)
   * to its metadata plus the owning project.
   *
   * This backs deep links like `/session/:sessionId`: the frontend's paginated
   * project payloads only carry each project's first session page, so a
   * session opened directly by URL may not be present client-side at all —
   * this lookup is the authoritative way to learn which project owns it.
   */
  getSessionDetailsById(sessionId: string): SessionDetails {
    const session =
      sessionsDb.getSessionById(sessionId) ?? sessionsDb.getSessionByProviderSessionId(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const projectPath = session.project_path?.trim() ? session.project_path : null;
    const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;

    return {
      sessionId: session.session_id,
      provider: session.provider as LLMProvider,
      summary: session.custom_name?.trim() || '',
      createdAt: session.created_at ?? null,
      updatedAt: session.updated_at ?? null,
      lastActivity: session.updated_at ?? session.created_at ?? null,
      isArchived: Boolean(session.isArchived),
      project: project && projectPath
        ? {
            projectId: project.project_id,
            path: projectPath,
            fullPath: projectPath,
            displayName: resolveProjectDisplayName(projectPath, project.custom_project_name),
            isStarred: Boolean(project.isStarred),
            isArchived: Boolean(project.isArchived),
          }
        : null,
    };
  },

  /**
   * Returns archived sessions with enough project metadata for the sidebar to
   * group, filter, open, and restore them without a per-row follow-up query.
   */
  listArchivedSessions(): ArchivedSessionListItem[] {
    const archivedSessions = sessionsDb.getArchivedSessions();
    const projectCache = new Map<string, ReturnType<typeof projectsDb.getProjectPath>>();

    return archivedSessions.map((session) => {
      const projectPath = session.project_path?.trim() ? session.project_path : null;
      let project = null;

      if (projectPath) {
        if (!projectCache.has(projectPath)) {
          projectCache.set(projectPath, projectsDb.getProjectPath(projectPath));
        }
        project = projectCache.get(projectPath) ?? null;
      }

      return {
        sessionId: session.session_id,
        provider: session.provider as LLMProvider,
        providerProfileId: session.provider_profile_id ?? null,
        projectId: project?.project_id ?? null,
        projectPath,
        projectDisplayName: resolveProjectDisplayName(projectPath, project?.custom_project_name),
        sessionTitle: session.custom_name?.trim() || session.session_id,
        createdAt: session.created_at ?? null,
        updatedAt: session.updated_at ?? null,
        lastActivity: session.updated_at ?? session.created_at ?? null,
        isProjectArchived: Boolean(project?.isArchived),
      };
    });
  },

  /**
   * Archives or permanently deletes one persisted session row by id.
   *
   * Soft-delete mirrors the project behavior by toggling `isArchived` so the
   * row disappears from active lists but remains restorable. Force-delete
   * optionally removes the transcript file before deleting the database row.
   */
  async deleteOrArchiveSessionById(
    sessionId: string,
    options: {
      force?: boolean;
      deletedFromDisk?: boolean;
    } = {},
  ): Promise<{ sessionId: string; action: 'archived' | 'deleted'; deletedFromDisk: boolean }> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!options.force) {
      sessionsDb.updateSessionIsArchived(sessionId, true);
      return {
        sessionId,
        action: 'archived',
        deletedFromDisk: false,
      };
    }

    let removedFromDisk = false;
    if (options.deletedFromDisk && session.jsonl_path) {
      removedFromDisk = await removeFileIfExists(session.jsonl_path);
    }

    const deleted = sessionsDb.deleteSessionById(sessionId);
    if (!deleted) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    return {
      sessionId,
      action: 'deleted',
      deletedFromDisk: removedFromDisk,
    };
  },

  /**
   * Restores one archived session back into the active sidebar lists.
   */
  restoreSessionById(sessionId: string): { sessionId: string; isArchived: false } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionIsArchived(sessionId, false);
    return { sessionId, isArchived: false };
  },

  /**
   * Renames one session by id without requiring the caller to pass provider.
   */
  renameSessionById(sessionId: string, summary: string): { sessionId: string; summary: string } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionCustomName(sessionId, summary);
    return { sessionId, summary };
  },
};
