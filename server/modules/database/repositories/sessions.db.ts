import { getConnection } from '@/modules/database/connection.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { normalizeProjectPath } from '@/shared/utils.js';

type SessionRow = {
  session_id: string;
  provider: string;
  provider_session_id: string | null;
  provider_profile_id: number | null;
  parent_session_id: string | null;
  agent_type: string | null;
  agent_status: string | null;
  project_path: string | null;
  jsonl_path: string | null;
  custom_name: string | null;
  isArchived: number;
  fork_context: string | null;
  fork_context_consumed: number;
  created_at: string;
  updated_at: string;
};

type ProviderBranchState = 'staged' | 'current' | 'superseded' | 'abandoned';

type ProviderBranchRow = {
  id: number;
  app_session_id: string;
  provider: string;
  provider_session_id: string;
  jsonl_path: string | null;
  state: ProviderBranchState;
  forked_from_provider_session_id: string | null;
  fork_point_id: string | null;
  created_at: string;
  updated_at: string;
};

const SESSION_ROW_COLUMNS =
  'session_id, provider, provider_session_id, provider_profile_id, parent_session_id, agent_type, agent_status, project_path, jsonl_path, custom_name, isArchived, fork_context, fork_context_consumed, created_at, updated_at';

/**
 * Sub-agent transcripts live in the same table as their parent session so the
 * existing message pipeline can render them unchanged. Every query that powers
 * a session *list* must therefore exclude child rows — otherwise agents leak
 * into the sidebar, search, and archive views as if they were real sessions.
 * Lookups by id deliberately omit this clause so an agent transcript stays
 * addressable.
 */
const TOP_LEVEL_SESSION_CLAUSE = 'parent_session_id IS NULL';

const SQLITE_UTC_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function normalizeTimestamp(value?: string): string | null {
  if (!value) return null;

  // SQLite CURRENT_TIMESTAMP is stored as UTC without a timezone suffix.
  // Normalize it here so every session reader returns canonical ISO strings
  // and the sidebar never interprets fresh rows as local-time "hours old".
  const normalizedValue = SQLITE_UTC_TIMESTAMP_REGEX.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;

  const parsed = new Date(normalizedValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeSessionRow<T extends SessionRow | null | undefined>(row: T): T {
  if (!row) {
    return row;
  }

  return {
    ...row,
    created_at: normalizeTimestamp(row.created_at) ?? row.created_at,
    updated_at: normalizeTimestamp(row.updated_at) ?? row.updated_at,
  };
}

function normalizeSessionRows(rows: SessionRow[]): SessionRow[] {
  return rows.map((row) => normalizeSessionRow(row) as SessionRow);
}

function normalizeProjectPathForProvider(provider: string, projectPath: string): string {
  void provider;
  return normalizeProjectPath(projectPath);
}

export const sessionsDb = {
  /**
   * Upserts one session row discovered on disk by a provider synchronizer.
   *
   * The given id is the provider-native session id. Rows are keyed by
   * `provider_session_id` so a session that was first created by the app
   * (with an app-allocated `session_id`) is updated in place once its
   * transcript shows up on disk, instead of producing a duplicate row.
   */
  createSession(
    providerSessionId: string,
    provider: string,
    projectPath: string,
    customName?: string,
    createdAt?: string,
    updatedAt?: string,
    jsonlPath?: string | null
  ): string {
    const db = getConnection();
    const createdAtValue = normalizeTimestamp(createdAt);
    const updatedAtValue = normalizeTimestamp(updatedAt);
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);

    // First, ensure the project path is recorded in the projects table,
    // since it's a foreign key in the sessions table.
    projectsDb.createProjectPath(normalizedProjectPath);

    const existing = db
      .prepare(
        `SELECT session_id FROM sessions
         WHERE provider_session_id = ? AND provider = ?
           AND ${TOP_LEVEL_SESSION_CLAUSE}
         LIMIT 1`
      )
      .get(providerSessionId, provider) as { session_id: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE sessions SET
           provider = ?,
           updated_at = COALESCE(?, CURRENT_TIMESTAMP),
           project_path = ?,
           jsonl_path = ?,
           isArchived = 0,
           custom_name = COALESCE(?, custom_name)
         WHERE session_id = ?`
      ).run(
        provider,
        updatedAtValue,
        normalizedProjectPath,
        jsonlPath ?? null,
        customName ?? null,
        existing.session_id
      );

      return existing.session_id;
    }

    // Sessions created outside the app (directly via the provider CLI) are
    // keyed by the provider-native id for both columns. The ON CONFLICT path
    // covers legacy rows that predate the provider_session_id mapping.
    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, provider_profile_id, custom_name, project_path, jsonl_path, isArchived, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 0, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(session_id) DO UPDATE SET
         provider = excluded.provider,
         provider_session_id = excluded.provider_session_id,
         updated_at = excluded.updated_at,
         project_path = excluded.project_path,
         jsonl_path = excluded.jsonl_path,
         isArchived = 0,
         custom_name = COALESCE(excluded.custom_name, sessions.custom_name)`
    ).run(
      providerSessionId,
      provider,
      providerSessionId,
      customName ?? null,
      normalizedProjectPath,
      jsonlPath ?? null,
      createdAtValue,
      updatedAtValue
    );

    return providerSessionId;
  },

  /**
   * Upserts one sub-agent transcript as a child row of the session that
   * spawned it.
   *
   * Kept separate from `createSession` on purpose: that method keys rows by
   * `provider_session_id` and would happily adopt an agent transcript into the
   * parent's row, overwriting the parent's `jsonl_path`. Child rows are keyed
   * directly by their own agent id instead.
   */
  createSubagentSession(input: {
    agentSessionId: string;
    provider: string;
    parentSessionId: string;
    projectPath: string;
    jsonlPath: string;
    agentType?: string | null;
    agentStatus?: string | null;
    customName?: string | null;
    createdAt?: string;
    updatedAt?: string;
  }): string {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPathForProvider(input.provider, input.projectPath);

    projectsDb.createProjectPath(normalizedProjectPath);

    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, provider_profile_id, parent_session_id, agent_type, agent_status, custom_name, project_path, jsonl_path, isArchived, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(session_id) DO UPDATE SET
         provider = excluded.provider,
         parent_session_id = excluded.parent_session_id,
         agent_type = COALESCE(excluded.agent_type, sessions.agent_type),
         agent_status = COALESCE(excluded.agent_status, sessions.agent_status),
         updated_at = excluded.updated_at,
         project_path = excluded.project_path,
         jsonl_path = excluded.jsonl_path,
         custom_name = COALESCE(excluded.custom_name, sessions.custom_name)`
    ).run(
      input.agentSessionId,
      input.provider,
      input.agentSessionId,
      input.parentSessionId,
      input.agentType ?? null,
      input.agentStatus ?? null,
      input.customName ?? null,
      normalizedProjectPath,
      input.jsonlPath,
      normalizeTimestamp(input.createdAt),
      normalizeTimestamp(input.updatedAt)
    );

    return input.agentSessionId;
  },

  /**
   * Returns the sub-agent transcripts spawned by one session, oldest first so
   * the sidebar tree reads in spawn order.
   */
  getSubagentsByParentSessionId(parentSessionId: string): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE parent_session_id = ?
         ORDER BY datetime(COALESCE(created_at, updated_at)) ASC, session_id ASC`
      )
      .all(parentSessionId) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Counts sub-agents for a whole page of sessions in one query.
   *
   * The sidebar needs an agent count per row to decide whether to render the
   * expand chevron; querying per session would mean one round trip per visible
   * row, so callers pass the entire page instead.
   */
  countSubagentsByParentSessionIds(parentSessionIds: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    if (parentSessionIds.length === 0) {
      return counts;
    }

    const db = getConnection();
    const placeholders = parentSessionIds.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT parent_session_id, COUNT(*) AS count
         FROM sessions
         WHERE parent_session_id IN (${placeholders})
         GROUP BY parent_session_id`
      )
      .all(...parentSessionIds) as Array<{ parent_session_id: string; count: number }>;

    for (const row of rows) {
      counts.set(row.parent_session_id, Number(row.count ?? 0));
    }

    return counts;
  },

  /**
   * Inserts one app-allocated session row before any provider run happens.
   *
   * The session gateway uses this when the frontend starts a brand-new chat:
   * `session_id` is the stable app-facing id, while `provider_session_id`
   * stays NULL until the provider runtime announces its own id and
   * `assignProviderSessionId` records the mapping.
   */
  createAppSession(
    sessionId: string,
    provider: string,
    projectPath: string,
    providerProfileId: number | null = null
  ): string {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);

    projectsDb.createProjectPath(normalizedProjectPath);

    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, provider_profile_id, custom_name, project_path, jsonl_path, isArchived, created_at, updated_at)
       VALUES (?, ?, NULL, ?, NULL, ?, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(sessionId, provider, providerProfileId, normalizedProjectPath);

    return sessionId;
  },

  /**
   * Records the provider-native session id for one app-allocated session.
   *
   * If the filesystem watcher indexed the provider transcript before this
   * mapping was recorded (a duplicate row keyed by the provider id exists),
   * the duplicate is merged into the app row: its transcript path and name
   * are adopted and the duplicate row is removed. Runs in a transaction so
   * the sidebar can never observe both rows at once.
   */
  assignProviderSessionId(sessionId: string, providerSessionId: string): void {
    const db = getConnection();

    const merge = db.transaction(() => {
      const duplicate = db
        .prepare(
          `SELECT ${SESSION_ROW_COLUMNS} FROM sessions
           WHERE (session_id = ? OR provider_session_id = ?)
             AND session_id <> ?
             AND ${TOP_LEVEL_SESSION_CLAUSE}
           LIMIT 1`
        )
        .get(providerSessionId, providerSessionId, sessionId) as SessionRow | undefined;

      let discoveredJsonlPath: string | null = null;
      if (duplicate) {
        discoveredJsonlPath = duplicate.jsonl_path;
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(duplicate.session_id);
        db.prepare(
          `UPDATE sessions SET
             provider_session_id = ?,
             jsonl_path = COALESCE(jsonl_path, ?),
             custom_name = COALESCE(custom_name, ?),
             updated_at = CURRENT_TIMESTAMP
           WHERE session_id = ?`
        ).run(providerSessionId, duplicate.jsonl_path, duplicate.custom_name, sessionId);
      } else {
        db.prepare(
          `UPDATE sessions SET
             provider_session_id = ?,
             updated_at = CURRENT_TIMESTAMP
           WHERE session_id = ?`
        ).run(providerSessionId, sessionId);
      }

      const hasBranchLineage = Boolean(
        db.prepare(
          'SELECT 1 FROM session_provider_branches WHERE app_session_id = ? LIMIT 1'
        ).get(sessionId)
      );
      if (hasBranchLineage) {
        db.prepare(
          `UPDATE session_provider_branches
           SET state = 'superseded', updated_at = CURRENT_TIMESTAMP
           WHERE app_session_id = ? AND state = 'current' AND provider_session_id <> ?`
        ).run(sessionId, providerSessionId);
        const provider = db
          .prepare('SELECT provider FROM sessions WHERE session_id = ?')
          .get(sessionId) as { provider?: string } | undefined;
        if (provider?.provider) {
          db.prepare(
            `INSERT INTO session_provider_branches (
               app_session_id, provider, provider_session_id, jsonl_path, state
             ) VALUES (?, ?, ?, ?, 'current')
             ON CONFLICT(provider, provider_session_id) DO UPDATE SET
               app_session_id = excluded.app_session_id,
               jsonl_path = COALESCE(excluded.jsonl_path, session_provider_branches.jsonl_path),
               state = 'current',
               updated_at = CURRENT_TIMESTAMP`
          ).run(sessionId, provider.provider, providerSessionId, discoveredJsonlPath);
        }
      }
    });

    merge();
  },

  /** Returns branch ownership for one provider-native session id. */
  getProviderBranch(provider: string, providerSessionId: string): ProviderBranchRow | null {
    const row = getConnection()
      .prepare(
        `SELECT id, app_session_id, provider, provider_session_id, jsonl_path, state,
                forked_from_provider_session_id, fork_point_id, created_at, updated_at
         FROM session_provider_branches
         WHERE provider = ? AND provider_session_id = ?
         LIMIT 1`
      )
      .get(provider, providerSessionId) as ProviderBranchRow | undefined;
    return row ?? null;
  },

  listProviderBranches(appSessionId: string): ProviderBranchRow[] {
    return getConnection()
      .prepare(
        `SELECT id, app_session_id, provider, provider_session_id, jsonl_path, state,
                forked_from_provider_session_id, fork_point_id, created_at, updated_at
         FROM session_provider_branches
         WHERE app_session_id = ?
         ORDER BY id ASC`
      )
      .all(appSessionId) as ProviderBranchRow[];
  },

  updateProviderBranchPath(
    provider: string,
    providerSessionId: string,
    jsonlPath: string,
  ): void {
    getConnection()
      .prepare(
        `UPDATE session_provider_branches
         SET jsonl_path = ?, updated_at = CURRENT_TIMESTAMP
         WHERE provider = ? AND provider_session_id = ?`
      )
      .run(jsonlPath, provider, providerSessionId);
  },

  /**
   * Reserves a provider fork before it becomes the active branch. Staged and
   * abandoned branches are intentionally invisible to filesystem indexing.
   */
  stageProviderBranch(input: {
    appSessionId: string;
    provider: string;
    expectedProviderSessionId: string;
    providerSessionId: string;
    jsonlPath: string;
    forkPointId: string;
  }): void {
    const db = getConnection();
    db.transaction(() => {
      const session = db
        .prepare(
          `SELECT provider, provider_session_id FROM sessions
           WHERE session_id = ? AND ${TOP_LEVEL_SESSION_CLAUSE}`
        )
        .get(input.appSessionId) as {
          provider: string;
          provider_session_id: string | null;
        } | undefined;
      if (
        !session
        || session.provider !== input.provider
        || session.provider_session_id !== input.expectedProviderSessionId
      ) {
        throw new Error('Session provider branch changed before rewind could be staged.');
      }

      const existing = db
        .prepare(
          `SELECT app_session_id FROM session_provider_branches
           WHERE provider = ? AND provider_session_id = ?`
        )
        .get(input.provider, input.providerSessionId) as { app_session_id: string } | undefined;
      if (existing && existing.app_session_id !== input.appSessionId) {
        throw new Error('Provider branch is already owned by another session.');
      }

      db.prepare(
        `INSERT INTO session_provider_branches (
           app_session_id, provider, provider_session_id, jsonl_path, state,
           forked_from_provider_session_id, fork_point_id
         ) VALUES (?, ?, ?, ?, 'staged', ?, ?)
         ON CONFLICT(provider, provider_session_id) DO UPDATE SET
           jsonl_path = excluded.jsonl_path,
           state = 'staged',
           forked_from_provider_session_id = excluded.forked_from_provider_session_id,
           fork_point_id = excluded.fork_point_id,
           updated_at = CURRENT_TIMESTAMP`
      ).run(
        input.appSessionId,
        input.provider,
        input.providerSessionId,
        input.jsonlPath,
        input.expectedProviderSessionId,
        input.forkPointId,
      );
    })();
  },

  abandonProviderBranch(
    appSessionId: string,
    provider: string,
    providerSessionId: string,
  ): void {
    getConnection()
      .prepare(
        `UPDATE session_provider_branches
         SET state = 'abandoned', updated_at = CURRENT_TIMESTAMP
         WHERE app_session_id = ? AND provider = ? AND provider_session_id = ?
           AND state = 'staged'`
      )
      .run(appSessionId, provider, providerSessionId);
  },

  /**
   * Atomically switches the active provider branch without changing the
   * app-facing session id, title, project, or provider profile.
   */
  commitProviderBranchRewind(input: {
    appSessionId: string;
    provider: string;
    expectedProviderSessionId: string;
    providerSessionId: string;
    jsonlPath: string;
    forkPointId: string;
  }): void {
    const db = getConnection();
    db.transaction(() => {
      const session = db
        .prepare(
          `SELECT provider, provider_session_id, jsonl_path FROM sessions
           WHERE session_id = ? AND ${TOP_LEVEL_SESSION_CLAUSE}`
        )
        .get(input.appSessionId) as {
          provider: string;
          provider_session_id: string | null;
          jsonl_path: string | null;
        } | undefined;
      if (
        !session
        || session.provider !== input.provider
        || session.provider_session_id !== input.expectedProviderSessionId
      ) {
        throw new Error('Session provider branch changed before rewind could commit.');
      }

      const staged = db
        .prepare(
          `SELECT state, app_session_id FROM session_provider_branches
           WHERE provider = ? AND provider_session_id = ?`
        )
        .get(input.provider, input.providerSessionId) as {
          state: ProviderBranchState;
          app_session_id: string;
        } | undefined;
      if (!staged || staged.app_session_id !== input.appSessionId || staged.state !== 'staged') {
        throw new Error('Provider rewind branch was not staged for this session.');
      }

      db.prepare(
        `UPDATE session_provider_branches
         SET state = 'superseded', updated_at = CURRENT_TIMESTAMP
         WHERE app_session_id = ? AND state = 'current'`
      ).run(input.appSessionId);
      db.prepare(
        `INSERT INTO session_provider_branches (
           app_session_id, provider, provider_session_id, jsonl_path, state,
           forked_from_provider_session_id, fork_point_id
         ) VALUES (?, ?, ?, ?, 'superseded', NULL, ?)
         ON CONFLICT(provider, provider_session_id) DO UPDATE SET
           app_session_id = excluded.app_session_id,
           jsonl_path = COALESCE(session_provider_branches.jsonl_path, excluded.jsonl_path),
           state = 'superseded',
           updated_at = CURRENT_TIMESTAMP`
      ).run(
        input.appSessionId,
        input.provider,
        input.expectedProviderSessionId,
        session.jsonl_path,
        input.forkPointId,
      );

      // The watcher may have indexed the fork in the short interval between
      // provider file creation and branch staging. Merge that temporary row.
      db.prepare(
        `DELETE FROM sessions
         WHERE session_id <> ?
           AND ${TOP_LEVEL_SESSION_CLAUSE}
           AND provider = ?
           AND (session_id = ? OR provider_session_id = ?)`
      ).run(
        input.appSessionId,
        input.provider,
        input.providerSessionId,
        input.providerSessionId,
      );
      db.prepare('DELETE FROM sessions WHERE parent_session_id = ?').run(input.appSessionId);
      db.prepare(
        `UPDATE sessions SET
           provider_session_id = ?,
           jsonl_path = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ?`
      ).run(input.providerSessionId, input.jsonlPath, input.appSessionId);
      db.prepare(
        `UPDATE session_provider_branches
         SET state = 'current', jsonl_path = ?, updated_at = CURRENT_TIMESTAMP
         WHERE app_session_id = ? AND provider = ? AND provider_session_id = ?`
      ).run(input.jsonlPath, input.appSessionId, input.provider, input.providerSessionId);
    })();
  },

  /** Rewinds the first prompt by returning the stable app chat to an empty provider binding. */
  resetProviderBranchForRewind(input: {
    appSessionId: string;
    provider: string;
    expectedProviderSessionId: string;
    forkPointId: string;
  }): void {
    const db = getConnection();
    db.transaction(() => {
      const session = db
        .prepare(
          `SELECT provider, provider_session_id, jsonl_path FROM sessions
           WHERE session_id = ? AND ${TOP_LEVEL_SESSION_CLAUSE}`
        )
        .get(input.appSessionId) as {
          provider: string;
          provider_session_id: string | null;
          jsonl_path: string | null;
        } | undefined;
      if (
        !session
        || session.provider !== input.provider
        || session.provider_session_id !== input.expectedProviderSessionId
      ) {
        throw new Error('Session provider branch changed before rewind could reset it.');
      }

      db.prepare(
        `UPDATE session_provider_branches
         SET state = 'superseded', updated_at = CURRENT_TIMESTAMP
         WHERE app_session_id = ? AND state = 'current'`
      ).run(input.appSessionId);
      db.prepare(
        `INSERT INTO session_provider_branches (
           app_session_id, provider, provider_session_id, jsonl_path, state,
           fork_point_id
         ) VALUES (?, ?, ?, ?, 'superseded', ?)
         ON CONFLICT(provider, provider_session_id) DO UPDATE SET
           app_session_id = excluded.app_session_id,
           jsonl_path = COALESCE(session_provider_branches.jsonl_path, excluded.jsonl_path),
           state = 'superseded',
           updated_at = CURRENT_TIMESTAMP`
      ).run(
        input.appSessionId,
        input.provider,
        input.expectedProviderSessionId,
        session.jsonl_path,
        input.forkPointId,
      );
      db.prepare('DELETE FROM sessions WHERE parent_session_id = ?').run(input.appSessionId);
      db.prepare(
        `UPDATE sessions SET
           provider_session_id = NULL,
           jsonl_path = NULL,
           updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ?`
      ).run(input.appSessionId);
    })();
  },

  updateSessionCustomName(sessionId: string, customName: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET custom_name = ?
       WHERE session_id = ?`
    ).run(customName, sessionId);
  },

  /**
   * Stores the carried-over context (a handoff summary or rendered transcript
   * fallback) on a freshly forked session row. NULL clears it.
   */
  setForkContext(sessionId: string, context: string | null): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET fork_context = ?
       WHERE session_id = ?`
    ).run(context, sessionId);
  },

  /**
   * Marks the carried-over context as consumed so it is prepended to only the
   * first chat.send of the forked session.
   */
  markForkContextConsumed(sessionId: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET fork_context_consumed = 1
       WHERE session_id = ?`
    ).run(sessionId);
  },

  /**
   * Bumps only `updated_at` so the sidebar re-sorts the session to the top.
   * Used by the rewind path — we want a visible sidebar bump without writing
   * any other field that would trigger the synchronizer to re-index the file.
   */
  bumpSessionUpdatedAt(sessionId: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`
    ).run(sessionId);
  },

  getSessionById(sessionId: string): SessionRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE session_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(sessionId) as SessionRow | undefined;

    return normalizeSessionRow(row) ?? null;
  },

  /**
   * Resolves one session row through the provider-native id.
   *
   * The filesystem watcher only knows provider ids (they come from transcript
   * file names), so it uses this lookup to translate disk artifacts back to
   * the app-facing session row before broadcasting sidebar updates.
   */
  getSessionByProviderSessionId(providerSessionId: string): SessionRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE provider_session_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(providerSessionId) as SessionRow | undefined;

    return normalizeSessionRow(row) ?? null;
  },

  /**
   * Finds the newest app-created session for a project that is still waiting
   * for its provider-native id to be recorded.
   *
   * Primary intention: OpenCode can expose a new session in its shared
   * `opencode.db` before the websocket runtime reports that same provider id
   * back to our app. At that moment the sidebar already has an optimistic
   * app-owned session row, but the watcher only knows the provider-native id.
   *
   * Without this lookup, the synchronizer would insert a second row keyed by
   * the provider id, then `assignProviderSessionId()` would merge it a moment
   * later. That eventually self-heals, but on slow networks the user can still
   * briefly see two sidebar sessions for the same conversation.
   *
   * This helper lets the synchronizer claim the pending app row first, so the
   * provider id is attached before any watcher-created row exists. The result
   * is simpler than frontend dedupe and keeps the race resolved at the source.
   */
  findLatestPendingAppSession(provider: string, projectPath: string): SessionRow | null {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE provider = ?
           AND project_path = ?
           AND provider_session_id IS NULL
           AND isArchived = 0
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT 1`
      )
      .get(provider, normalizedProjectPath) as SessionRow | undefined;

    return normalizeSessionRow(row) ?? null;
  },

  getAllSessions(): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE isArchived = 0
           AND ${TOP_LEVEL_SESSION_CLAUSE}`
      )
      .all() as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Returns active sessions whose latest recorded activity is on or after the
   * supplied UTC timestamp. One global query keeps the recent-chat sidebar
   * independent from per-project pagination limits.
   */
  getSessionsUpdatedSince(since: string): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE isArchived = 0
           AND ${TOP_LEVEL_SESSION_CLAUSE}
           AND project_path IS NOT NULL
           AND datetime(COALESCE(updated_at, created_at)) >= datetime(?)
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC`
      )
      .all(since) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Archived rows are intentionally queried separately so the caller can render
   * them in a dedicated view without reintroducing them into active session lists.
   */
  getArchivedSessions(): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE isArchived = 1
           AND ${TOP_LEVEL_SESSION_CLAUSE}
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC`
      )
      .all() as SessionRow[];

    return normalizeSessionRows(rows);
  },

  getSessionsByProjectPath(projectPath: string): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0
           AND ${TOP_LEVEL_SESSION_CLAUSE}`
      )
      .all(normalizedProjectPath) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Permanent project deletion must see every session row for the path,
   * including archived ones, so their transcript files can be cleaned up.
   *
   * Unlike the other project-path readers this intentionally keeps sub-agent
   * child rows: their transcripts are separate files on disk and would be
   * orphaned if deletion only walked top-level sessions. Callers that render a
   * session *list* from this must drop child rows themselves.
   */
  getSessionsByProjectPathIncludingArchived(projectPath: string): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?`
      )
      .all(normalizedProjectPath) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  getSessionsByProjectPathPage(projectPath: string, limit: number, offset: number): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0
           AND ${TOP_LEVEL_SESSION_CLAUSE}
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT ? OFFSET ?`
      )
      .all(normalizedProjectPath, limit, offset) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  countSessionsByProjectPath(projectPath: string): number {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0
           AND ${TOP_LEVEL_SESSION_CLAUSE}`
      )
      .get(normalizedProjectPath) as { count: number } | undefined;

    return Number(row?.count ?? 0);
  },

  deleteSessionsByProjectPath(projectPath: string): void {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    db.prepare(`DELETE FROM sessions WHERE project_path = ?`).run(normalizedProjectPath);
  },

  getSessionName(sessionId: string, provider: string): string | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT custom_name
         FROM sessions
         WHERE session_id = ? AND provider = ?`
      )
      .get(sessionId, provider) as { custom_name: string | null } | undefined;

    return row?.custom_name ?? null;
  },

  /**
   * Bumps the row's `updated_at` so the sidebar re-sorts the session to the
   * top of its recent list. Used by rewind-style operations that mutate the
   * transcript without spawning a new run.
   */
  touchSession(sessionId: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`
    ).run(sessionId);
  },

  /**
   * Soft-delete and restore both use the same flag update so callers keep the
   * row, metadata, and file path intact while toggling visibility.
   */
  updateSessionIsArchived(sessionId: string, isArchived: boolean): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET isArchived = ?
       WHERE session_id = ?`
    ).run(isArchived ? 1 : 0, sessionId);
  },

  /**
   * Deleting a session also drops the sub-agent rows it spawned, so agent
   * transcripts can never outlive their parent as unreachable orphans.
   */
  deleteSessionById(sessionId: string): boolean {
    const db = getConnection();
    const remove = db.transaction(() => {
      db.prepare('DELETE FROM sessions WHERE parent_session_id = ?').run(sessionId);
      return db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId).changes > 0;
    });

    return remove();
  },
};
