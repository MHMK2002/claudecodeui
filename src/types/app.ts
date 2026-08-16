export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'opencode';

export type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
  effort?: {
    default?: string;
    values: {
      value: string;
      description?: string;
    }[];
  };
};

export type ProviderModelsDefinition = {
  OPTIONS: ProviderModelOption[];
  DEFAULT: string;
};

export type ProviderModelsCacheInfo = {
  updatedAt: string;
  expiresAt: string;
  source: 'memory' | 'disk' | 'fresh';
};

export type ProviderProfileProvider = 'claude' | 'codex';

export type ProviderProfileAuthType = 'auth_token' | 'api_key';

export type ClaudeProviderProfileAuthType = ProviderProfileAuthType;
export type CodexProviderProfileAuthType = 'api_key';

export type ProviderProfilePublic<TProvider extends ProviderProfileProvider = ProviderProfileProvider> = {
  id: number;
  provider: TProvider;
  title: string;
  baseUrl: string | null;
  authType: ProviderProfileAuthType;
  isDefault: boolean;
  isActive: boolean;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ClaudeProviderProfilePublic = ProviderProfilePublic<'claude'>;
export type CodexProviderProfilePublic = ProviderProfilePublic<'codex'> & {
  authType: CodexProviderProfileAuthType;
};

/**
 * One selectable profile row inside the public provider selection catalog.
 *
 * Identity is (provider, id) — numeric ids may collide across providers. The
 * backend never sends credential fields here; only id/title/isDefault.
 */
export type ProviderSelectionCatalogProfile = {
  id: number;
  title: string;
  isDefault: boolean;
};

/**
 * One provider entry inside the public selection catalog.
 *
 * `available` is false when the provider cannot be selected right now (no
 * active profile for Claude/Codex, disconnected CLI for Cursor/OpenCode);
 * `unavailableReason` explains why for disabled pickers. Models stay
 * provider-level — per-profile model discovery is out of scope.
 */
export type ProviderSelectionCatalogEntry = {
  provider: LLMProvider;
  available: boolean;
  unavailableReason: string | null;
  /** Active profiles; empty for Cursor/OpenCode, which never use profiles. */
  profiles: ProviderSelectionCatalogProfile[];
  /** Provider-level model catalog (options and default model). */
  models: ProviderModelsDefinition;
};

/**
 * Public selection catalog returned by `GET /api/providers/selection-catalog`.
 * The single shared source every provider picker consumes.
 */
export type ProviderSelectionCatalog = {
  providers: ProviderSelectionCatalogEntry[];
};

/**
 * A fully-resolved provider selection: which provider, which runtime profile,
 * and which model a new session or fork will run with.
 *
 * For connection-backed providers (cursor, opencode) `providerProfileId` is
 * always null — that is their natural architecture, not a legacy state.
 */
export type ResolvedProviderSelection = {
  provider: LLMProvider;
  providerProfileId: number | null;
  model: string;
};

export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'schedules' | 'browser' | `plugin:${string}`;

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  // Number of sub-agents this session spawned; drives the sidebar's
  // third-level expand affordance.
  agentCount?: number;
  // Defensive compatibility for legacy payloads. Canonical project session
  // lists contain roots only; sub-agent transcripts use SubagentTranscript.
  parentSessionId?: string;
  agentType?: string | null;
  provider?: LLMProvider;
  __provider?: LLMProvider;
  providerProfileId?: number | null;
  __providerProfileId?: number | null;
  // Tags the session with the owning project's DB `projectId` so UI handlers
  // (session switching, sidebar focus, etc.) can match against selectedProject.
  __projectId?: string;
  [key: string]: unknown;
}

export type SubagentStatus = 'running' | 'completed' | 'unknown';

/** A read-only transcript nested under a root session, never a root session. */
export type SubagentTranscript = {
  sessionId: string;
  provider: LLMProvider;
  parentSessionId: string;
  name: string;
  agentType: string | null;
  status: SubagentStatus;
  toolCount: number;
  currentTool: { toolName: string; toolInput: unknown } | null;
  totalTokens: number | null;
  totalDurationMs: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// After the projectName → projectId migration the backend no longer returns a
// folder-derived `name` string. Projects are now addressed everywhere by the
// DB-assigned `projectId` (primary key in the `projects` table), and the UI
// uses the same identifier for routing, state keys and API calls.
export interface Project {
  projectId: string;
  displayName: string;
  fullPath: string;
  path?: string;
  isStarred?: boolean;
  sessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  [key: string]: unknown;
}

export interface LoadingProgress {
  kind?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}
