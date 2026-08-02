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

export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'browser' | `plugin:${string}`;

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
  provider?: LLMProvider;
  __provider?: LLMProvider;
  providerProfileId?: number | null;
  __providerProfileId?: number | null;
  // Tags the session with the owning project's DB `projectId` so UI handlers
  // (session switching, sidebar focus, etc.) can match against selectedProject.
  __projectId?: string;
  [key: string]: unknown;
}

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
