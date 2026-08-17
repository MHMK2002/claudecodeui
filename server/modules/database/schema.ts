const USER_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1,
    git_name TEXT,
    git_email TEXT,
    commit_message_provider TEXT,
    commit_message_provider_profile_id INTEGER,
    commit_message_model TEXT,
    commit_message_effort TEXT,
    commit_message_base_prompt TEXT,
    has_completed_onboarding BOOLEAN DEFAULT 0
);
`;

export const API_KEYS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const USER_CREDENTIALS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_name TEXT NOT NULL,
    credential_type TEXT NOT NULL, -- 'github_token', 'gitlab_token', 'bitbucket_token', etc.
    credential_value TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const PROVIDER_PROFILES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS provider_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    title TEXT NOT NULL,
    base_url TEXT,
    auth_type TEXT NOT NULL DEFAULT 'auth_token',
    secret_value TEXT NOT NULL,
    is_default BOOLEAN DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_notification_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const VAPID_KEYS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS vapid_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export const PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notification_channel_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    label TEXT,
    metadata_json TEXT,
    enabled BOOLEAN DEFAULT 1,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, channel, endpoint_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const PROJECTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    project_path TEXT NOT NULL UNIQUE,
    custom_project_name TEXT DEFAULT NULL,
    isStarred BOOLEAN DEFAULT 0,
    isArchived BOOLEAN DEFAULT 0
);
`;

export const SESSIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    -- The session id used by the provider CLI/SDK on disk (JSONL file name,
    -- store.db folder, sqlite row id, ...). \`session_id\` is the stable
    -- app-facing id that the frontend uses for the whole session lifetime;
    -- \`provider_session_id\` is filled in once the provider announces its own
    -- id mid-run, or equals \`session_id\` for sessions discovered on disk.
    provider_session_id TEXT,
    provider_profile_id INTEGER,
    -- Sub-agent transcripts (Claude \`Task\` agents, Codex spawned threads) are
    -- stored as child rows of the session that spawned them. \`parent_session_id\`
    -- holds the app-facing id of that parent; it stays NULL for real sessions,
    -- and every session *listing* query filters on \`parent_session_id IS NULL\`
    -- so agents surface only under their own session in the sidebar tree.
    parent_session_id TEXT,
    agent_type TEXT,
    agent_status TEXT,
    custom_name TEXT,
    project_path TEXT,
    jsonl_path TEXT,
    -- Model this session runs with. Written when the user picks a model for the
    -- session and on every send, so reopening a session restores the model it
    -- was last used with instead of falling back to the catalog default.
    model TEXT,
    isArchived BOOLEAN DEFAULT 0,
    -- Carried-over context when this session was forked from another. A short
    -- handoff summary (or rendered transcript fallback) of the source session,
    -- prepended to the FIRST chat.send only, then marked consumed. NULL for
    -- sessions that were not forked, or were forked without context carry-over.
    fork_context TEXT,
    fork_context_consumed INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id),
    FOREIGN KEY (project_path) REFERENCES projects(project_path)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);
`;

/**
 * Provider-native conversation branches owned by one stable CloudCLI chat.
 *
 * Rewind may create a new Claude/Codex session internally, but the frontend
 * must keep using the same `sessions.session_id`. Superseded/staged branches
 * stay recorded here so filesystem synchronizers never rediscover them as
 * standalone sidebar sessions.
 */
export const SESSION_PROVIDER_BRANCHES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session_provider_branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_session_id TEXT NOT NULL,
    jsonl_path TEXT,
    state TEXT NOT NULL CHECK (state IN ('staged', 'current', 'superseded', 'abandoned')),
    forked_from_provider_session_id TEXT,
    fork_point_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_session_id),
    FOREIGN KEY (app_session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);
`;

export const LAST_SCANNED_AT_SQL = `
CREATE TABLE IF NOT EXISTS scan_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_scanned_at TIMESTAMP NULL
);
`;

export const APP_CONFIG_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export const SCHEDULED_RUNS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS scheduled_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    project_id TEXT,
    project_path TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_profile_id INTEGER,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    notify_on_success BOOLEAN NOT NULL DEFAULT 0,
    notify_on_failure BOOLEAN NOT NULL DEFAULT 1,
    notify_channels_json TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT 1,
    last_run_at DATETIME,
    next_run_at DATETIME NOT NULL,
    in_flight_run_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (project_path) REFERENCES projects(project_path) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles(id) ON DELETE SET NULL
);
`;

export const SCHEDULED_RUN_HISTORY_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS scheduled_run_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    trigger TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    duration_ms INTEGER,
    output_summary TEXT,
    error_message TEXT,
    notification_dispatched BOOLEAN DEFAULT 0,
    FOREIGN KEY (schedule_id) REFERENCES scheduled_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const INIT_SCHEMA_SQL = `
-- Initialize authentication database
PRAGMA foreign_keys = ON;

${USER_TABLE_SCHEMA_SQL}
-- Indexes for performance for user lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

${API_KEYS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

${USER_CREDENTIALS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_user_credentials_active ON user_credentials(is_active);

${PROVIDER_PROFILES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_provider_profiles_user_provider ON provider_profiles(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_active ON provider_profiles(provider, is_active);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_default ON provider_profiles(user_id, provider, is_default);

${USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_user_id ON user_notification_preferences(user_id);

${VAPID_KEYS_TABLE_SCHEMA_SQL}

${PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

${NOTIFICATION_CHANNEL_ENDPOINTS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_user_channel ON notification_channel_endpoints(user_id, channel);
CREATE INDEX IF NOT EXISTS idx_notification_channel_endpoints_enabled ON notification_channel_endpoints(enabled);

${PROJECTS_TABLE_SCHEMA_SQL}
-- NOTE: These indexes are created in migrations after legacy table-shape repairs.
-- Creating them here can fail on upgraded installs where projects lacks those columns.

${SESSIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_session_ids_lookup ON sessions(session_id);
-- NOTE: This index is created in migrations after sessions is rebuilt to include project_path.
-- Creating it here can fail on upgraded installs where the legacy sessions table has no project_path.

${SESSION_PROVIDER_BRANCHES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_session_provider_branches_app ON session_provider_branches(app_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_provider_branches_current
ON session_provider_branches(app_session_id)
WHERE state = 'current';

${LAST_SCANNED_AT_SQL}

${APP_CONFIG_TABLE_SCHEMA_SQL}

${SCHEDULED_RUNS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_user_id ON scheduled_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_due ON scheduled_runs(is_enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_project ON scheduled_runs(project_path);
-- NOTE: The project_id index is created in migrations after legacy scheduled_runs
-- tables receive the project_id column.
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_in_flight ON scheduled_runs(in_flight_run_id);

${SCHEDULED_RUN_HISTORY_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_scheduled_run_history_schedule ON scheduled_run_history(schedule_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_run_history_user ON scheduled_run_history(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_run_history_running ON scheduled_run_history(status) WHERE status = 'running';
`;
