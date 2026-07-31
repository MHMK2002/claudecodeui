import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry, broadcastSessionRewound } from '@/modules/websocket/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import {
  findJsonlLine,
  truncateJsonlAtLine,
} from '@/modules/providers/shared/jsonl-truncate.js';
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
    };
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
   * Rewinds a session transcript back to one user message and drops
   * everything that came after it.
   *
   * The targeted line is the JSONL row that produces the user message whose
   * server uuid equals `messageId`; we never truncate mid-tool-call. The
   * rewrite is atomic on disk and a `.bak.<ts>` snapshot is preserved next
   * to the original file when a successful write completes.
   *
   * Rejects with 404 for missing/archived sessions, missing transcripts, or
   * a `messageId` that cannot be located on disk. Rejects with 409 when the
   * session is mid-run — caller should abort first via `chat.abort` and retry.
   */
  async rewindSession(
    sessionId: string,
    options: { messageId: string; keepMessage?: boolean },
  ): Promise<{
    sessionId: string;
    truncatedAt: string;
    kept: number;
    backupPath: string | null;
    cancelledRun: boolean;
  }> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }
    if (session.isArchived) {
      throw new AppError(`Session "${sessionId}" is archived and cannot be rewound.`, {
        code: 'SESSION_ARCHIVED',
        statusCode: 409,
      });
    }
    if (!session.jsonl_path) {
      throw new AppError(`Session "${sessionId}" has no transcript on disk yet.`, {
        code: 'SESSION_HAS_NO_TRANSCRIPT',
        statusCode: 409,
      });
    }
    if (!options?.messageId || typeof options.messageId !== 'string') {
      throw new AppError('messageId is required.', {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }

    const provider = session.provider as LLMProvider;
    const jsonlPath = session.jsonl_path;

    // Mid-run safety. Cancelling the writer flips the run to completed so any
    // subsequent event-bus fan-out is a no-op; we still truncate below even
    // if a live runtime appends new lines afterwards (the runtime keeps the
    // file descriptor open and may write more — those writes will land on
    // the truncated file, which is acceptable because the user is rolling
    // back the conversation anyway).
    const cancelledRun = chatRunRegistry.cancelRun(sessionId);

    // Locate the JSONL line whose uuid matches the targeted message and that
    // is a real user message (not a Claude compact summary, local command
    // stdout, or a Codex environment_context / boEntries row).
    //
    // Codex rollout rows carry no uuid; there the id is a timestamp-derived
    // `codex_ts_<epochMs>` and we match on the row's timestamp instead.
    const codexTargetMs = provider === 'codex'
      ? Number(options.messageId.replace(/^codex_ts_/, ''))
      : NaN;
    const search = await findJsonlLine(jsonlPath, (parsed) => {
      if (!parsed || typeof parsed !== 'object') return false;
      const record = parsed as Record<string, unknown>;

      if (provider === 'codex') {
        if (!Number.isFinite(codexTargetMs)) return false;
        const recordMs = Date.parse(String(record.timestamp ?? ''));
        if (recordMs !== codexTargetMs) return false;
        const payload = record.payload as Record<string, unknown> | undefined;
        if (!payload) return false;
        if (payload.type !== 'user_message') return false;
        if (payload.kind && payload.kind !== 'plain') return false;
        return typeof payload.message === 'string' && payload.message.trim().length > 0;
      }

      // Claude and any future uuid-bearing providers locate by uuid.
      if (record.uuid !== options.messageId) return false;
      if (provider === 'claude') {
        const message = record.message as { role?: string } | undefined;
        return message?.role === 'user' && record.isMeta !== true;
      }

      return false;
    });

    if (!search.found) {
      throw new AppError(
        `Message "${options.messageId}" was not found in this session's transcript.`,
        {
          code: 'REWIND_TARGET_NOT_FOUND',
          statusCode: 404,
        },
      );
    }

    // keepMessage=true → keep the user row itself; false → drop it too.
    const cutoff = options.keepMessage === false ? search.match.index : search.match.index + 1;

    const result = await truncateJsonlAtLine(jsonlPath, cutoff, { backup: true });
    sessionsDb.bumpSessionUpdatedAt(sessionId);

    const truncatedAt = new Date().toISOString();
    broadcastSessionRewound(sessionId, { truncatedAt, backupPath: result.backupPath });

    return {
      sessionId,
      truncatedAt,
      kept: result.kept,
      backupPath: result.backupPath,
      cancelledRun,
    };
  },

  /**
   * Edit a user message in-place. Semantically equivalent to rewinding with
   * `keepMessage: false` and then resubmitting via `chat.send` from the client.
   *
   * The transcript is truncated at the line BEFORE the targeted user message
   * (atomic JSONL rewrite — see `rewindSession`). The client is expected to
   * dispatch a fresh `chat.send` with the new content as the resubmit step.
   * `cancelledRun` reports whether an active run was flipped to completed; the
   * frontend treats this the same as a rewind.
   */
  async editUserMessage(
    sessionId: string,
    payload: { messageId: string; content: string; images?: unknown[] },
  ): Promise<{
    sessionId: string;
    truncatedAt: string;
    backupPath: string | null;
    cancelledRun: boolean;
  }> {
    if (!payload?.messageId || typeof payload.messageId !== 'string') {
      throw new AppError('messageId is required.', {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }
    if (!payload.content || typeof payload.content !== 'string' || !payload.content.trim()) {
      throw new AppError('content is required.', {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }

    const rewind = await this.rewindSession(sessionId, {
      messageId: payload.messageId,
      keepMessage: false,
    });

    return {
      sessionId: rewind.sessionId,
      truncatedAt: rewind.truncatedAt,
      backupPath: rewind.backupPath,
      cancelledRun: rewind.cancelledRun,
    };
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
