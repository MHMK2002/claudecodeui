import fs from 'node:fs/promises';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionSynchronizerService } from '@/modules/providers/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type SessionSummary = {
  id: string;
  provider: string;
  providerProfileId: number | null;
  summary: string;
  messageCount: number;
  // Number of sub-agent transcripts spawned by this session. Drives the
  // sidebar's third-level expand affordance.
  agentCount: number;
  lastActivity: string;
};

type SessionRepositoryRow = {
  provider: string;
  session_id: string;
  provider_profile_id?: number | null;
  parent_session_id?: string | null;
  project_path?: string | null;
  custom_name?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type ProjectListItem = {
  projectId: string;
  path: string;
  displayName: string;
  fullPath: string;
  isStarred: boolean;
  sessions: SessionSummary[];
  sessionMeta: {
    hasMore: boolean;
    total: number;
  };
};

export type ArchivedProjectListItem = ProjectListItem & {
  isArchived: true;
};

type ProgressUpdate = {
  phase: 'loading' | 'complete';
  current: number;
  total: number;
  currentProject?: string;
};

type GetProjectsWithSessionsOptions = {
  skipSynchronization?: boolean;
  sessionsLimit?: number;
  sessionsOffset?: number;
};

type GetRecentProjectsWithSessionsOptions = {
  skipSynchronization?: boolean;
  windowMinutes?: number;
  now?: Date;
};

type RecentProjectRepositoryRow = {
  project_id: string;
  project_path: string;
  custom_project_name?: string | null;
  isStarred?: number;
};

type RecentProjectsDependencies = {
  synchronizeSessions: () => Promise<unknown>;
  readProjectRows: () => RecentProjectRepositoryRow[];
  readSessionRows: (since: string) => SessionRepositoryRow[];
  readAgentCounts: (parentSessionIds: string[]) => Map<string, number>;
  resolveDisplayName: (projectName: string, actualProjectDir: string | null) => Promise<string>;
};

type SessionPaginationOptions = {
  limit?: number;
  offset?: number;
};

type ProjectSessionsPageResult = {
  sessions: SessionSummary[];
  total: number;
  hasMore: boolean;
};

export type ProjectSessionsPageApiView = {
  projectId: string;
  sessions: SessionSummary[];
  sessionMeta: {
    hasMore: boolean;
    total: number;
  };
};

const DEFAULT_PROJECT_SESSIONS_PAGE_SIZE = 20;
const MAX_PROJECT_SESSIONS_PAGE_SIZE = 200;
export const DEFAULT_RECENT_SESSIONS_WINDOW_MINUTES = 60;
export const MAX_RECENT_SESSIONS_WINDOW_MINUTES = 7 * 24 * 60;

/**
 * Generate better display name from path.
 */
export async function generateDisplayName(projectName: string, actualProjectDir: string | null = null): Promise<string> {
  // Use actual project directory if provided, otherwise decode from project name.
  const projectPath = actualProjectDir || projectName.replace(/-/g, '/');

  // Try to read package.json from the project path.
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData) as { name?: string };

    // Return the name from package.json if it exists.
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch {
    // Fall back to path-based naming if package.json doesn't exist or can't be read.
  }

  // If it starts with /, it's an absolute path.
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    // Return only the last folder name.
    return parts[parts.length - 1] || projectPath;
  }

  return projectPath;
}

function normalizeSessionPagination(options: SessionPaginationOptions = {}): { limit: number; offset: number } {
  const rawLimit = Number.isFinite(options.limit) ? Math.floor(Number(options.limit)) : DEFAULT_PROJECT_SESSIONS_PAGE_SIZE;
  const rawOffset = Number.isFinite(options.offset) ? Math.floor(Number(options.offset)) : 0;

  return {
    limit: Math.min(Math.max(1, rawLimit), MAX_PROJECT_SESSIONS_PAGE_SIZE),
    offset: Math.max(0, rawOffset),
  };
}

function mapSessionRowToSummary(row: SessionRepositoryRow, agentCount = 0): SessionSummary {
  return {
    id: row.session_id,
    provider: row.provider,
    providerProfileId: row.provider_profile_id ?? null,
    summary: row.custom_name || '',
    messageCount: 0,
    agentCount,
    lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
  };
}

/**
 * Attaches the sub-agent count to a page of session rows using a single
 * grouped query, so the sidebar can decide per row whether to render the
 * expand chevron without one round trip per session.
 */
function mapSessionRowsToSummaries(
  rows: SessionRepositoryRow[],
  readAgentCounts: (parentSessionIds: string[]) => Map<string, number> =
    (parentSessionIds) => sessionsDb.countSubagentsByParentSessionIds(parentSessionIds),
): SessionSummary[] {
  const agentCounts = readAgentCounts(rows.map((row) => row.session_id));
  return rows.map((row) => mapSessionRowToSummary(row, agentCounts.get(row.session_id) ?? 0));
}

function readProjectSessionsIncludingArchived(projectPath: string): ProjectSessionsPageResult {
  // This reader keeps sub-agent children (deletion needs their transcript
  // paths), so the archived-projects listing drops them here.
  const rows = (sessionsDb.getSessionsByProjectPathIncludingArchived(projectPath) as SessionRepositoryRow[])
    .filter((row) => !row.parent_session_id);

  return {
    sessions: mapSessionRowsToSummaries(rows),
    total: rows.length,
    hasMore: false,
  };
}

/**
 * Reads one paginated project session slice from the DB and groups rows by provider.
 */
function readProjectSessionsPageByPath(
  projectPath: string,
  options: SessionPaginationOptions = {},
): ProjectSessionsPageResult {
  const pagination = normalizeSessionPagination(options);
  const rows = sessionsDb.getSessionsByProjectPathPage(
    projectPath,
    pagination.limit,
    pagination.offset,
  ) as SessionRepositoryRow[];
  const total = sessionsDb.countSessionsByProjectPath(projectPath);

  return {
    sessions: mapSessionRowsToSummaries(rows),
    total,
    hasMore: pagination.offset + rows.length < total,
  };
}

// Broadcast progress to all connected WebSocket clients.
// Uses the unified `kind` envelope like every other websocket frame.
function broadcastProgress(progress: ProgressUpdate) {
  const message = JSON.stringify({
    kind: 'loading_progress',
    ...progress,
  });

  connectedClients.forEach((client: RealtimeClientConnection) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(message);
    }
  });
}

/**
 * Reads all projects from DB and returns normalized session summaries.
 */
export async function getProjectsWithSessions(
  options: GetProjectsWithSessionsOptions = {}
): Promise<ProjectListItem[]> {
  if (!options.skipSynchronization) {
    await sessionSynchronizerService.synchronizeSessions();
  }

  const projectRows = projectsDb.getProjectPaths() as Array<{
    project_id: string;
    project_path: string;
    custom_project_name?: string | null;
    isStarred?: number;
  }>;
  const totalProjects = projectRows.length;
  const projects: ProjectListItem[] = [];
  let processedProjects = 0;

  for (const row of projectRows) {
    processedProjects += 1;

    const projectId = row.project_id;
    const projectPath = row.project_path;

    broadcastProgress({
      phase: 'loading',
      current: processedProjects,
      total: totalProjects,
      currentProject: projectPath,
    });

    const displayName =
      row.custom_project_name && row.custom_project_name.trim().length > 0
        ? row.custom_project_name
        : await generateDisplayName(path.basename(projectPath) || projectPath, projectPath);

    const sessionsPage = readProjectSessionsPageByPath(projectPath, {
      limit: options.sessionsLimit,
      offset: options.sessionsOffset,
    });

    projects.push({
      projectId,
      path: projectPath,
      displayName,
      fullPath: projectPath,
      isStarred: Boolean(row.isStarred),
      sessions: sessionsPage.sessions,
      sessionMeta: {
        hasMore: sessionsPage.hasMore,
        total: sessionsPage.total,
      },
    });
  }

  broadcastProgress({
    phase: 'complete',
    current: totalProjects,
    total: totalProjects,
  });

  return projects;
}

/**
 * Reads recent active sessions in one global DB query, then groups them under
 * their active projects. Projects without activity inside the requested
 * window are deliberately omitted from this compact sidebar view.
 */
export async function getRecentProjectsWithSessions(
  options: GetRecentProjectsWithSessionsOptions = {},
  dependencies: RecentProjectsDependencies = {
    synchronizeSessions: () => sessionSynchronizerService.synchronizeSessions(),
    readProjectRows: () => projectsDb.getProjectPaths() as RecentProjectRepositoryRow[],
    readSessionRows: (since) => sessionsDb.getSessionsUpdatedSince(since) as SessionRepositoryRow[],
    readAgentCounts: (parentSessionIds) => sessionsDb.countSubagentsByParentSessionIds(parentSessionIds),
    resolveDisplayName: generateDisplayName,
  },
): Promise<ProjectListItem[]> {
  if (!options.skipSynchronization) {
    await dependencies.synchronizeSessions();
  }

  const requestedWindow = options.windowMinutes ?? DEFAULT_RECENT_SESSIONS_WINDOW_MINUTES;
  if (!Number.isInteger(requestedWindow) || requestedWindow < 1 || requestedWindow > MAX_RECENT_SESSIONS_WINDOW_MINUTES) {
    throw new AppError(
      `windowMinutes must be an integer between 1 and ${MAX_RECENT_SESSIONS_WINDOW_MINUTES}`,
      {
        code: 'INVALID_RECENT_SESSIONS_WINDOW',
        statusCode: 400,
      },
    );
  }

  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new AppError('now must be a valid date', {
      code: 'INVALID_RECENT_SESSIONS_NOW',
      statusCode: 400,
    });
  }

  const since = new Date(now.getTime() - requestedWindow * 60_000).toISOString();
  const recentRows = dependencies.readSessionRows(since);
  const rowsByProjectPath = new Map<string, SessionRepositoryRow[]>();

  for (const sessionRow of recentRows) {
    if (!sessionRow.project_path) {
      continue;
    }

    const projectSessions = rowsByProjectPath.get(sessionRow.project_path) ?? [];
    projectSessions.push(sessionRow);
    rowsByProjectPath.set(sessionRow.project_path, projectSessions);
  }

  const projectRows = dependencies.readProjectRows();
  const projects: ProjectListItem[] = [];

  for (const projectRow of projectRows) {
    const sessionRows = rowsByProjectPath.get(projectRow.project_path);
    if (!sessionRows || sessionRows.length === 0) {
      continue;
    }

    const displayName =
      projectRow.custom_project_name && projectRow.custom_project_name.trim().length > 0
        ? projectRow.custom_project_name
        : await dependencies.resolveDisplayName(
          path.basename(projectRow.project_path) || projectRow.project_path,
          projectRow.project_path,
        );
    const sessions = mapSessionRowsToSummaries(sessionRows, dependencies.readAgentCounts)
      .sort((left, right) => right.lastActivity.localeCompare(left.lastActivity));

    projects.push({
      projectId: projectRow.project_id,
      path: projectRow.project_path,
      displayName,
      fullPath: projectRow.project_path,
      isStarred: Boolean(projectRow.isStarred),
      sessions,
      sessionMeta: {
        hasMore: false,
        total: sessions.length,
      },
    });
  }

  return projects.sort((left, right) => {
    const leftActivity = left.sessions[0]?.lastActivity ?? '';
    const rightActivity = right.sessions[0]?.lastActivity ?? '';
    return rightActivity.localeCompare(leftActivity);
  });
}

/**
 * Reads archived projects from DB and includes every session row for each
 * project path, because an archived workspace should surface all preserved
 * conversation history in the archive view regardless of each session's flag.
 */
export async function getArchivedProjectsWithSessions(
  options: Pick<GetProjectsWithSessionsOptions, 'skipSynchronization'> = {},
): Promise<ArchivedProjectListItem[]> {
  if (!options.skipSynchronization) {
    await sessionSynchronizerService.synchronizeSessions();
  }

  const projectRows = projectsDb.getArchivedProjectPaths() as Array<{
    project_id: string;
    project_path: string;
    custom_project_name?: string | null;
    isStarred?: number;
  }>;

  const archivedProjects: ArchivedProjectListItem[] = [];

  for (const row of projectRows) {
    const displayName =
      row.custom_project_name && row.custom_project_name.trim().length > 0
        ? row.custom_project_name
        : await generateDisplayName(path.basename(row.project_path) || row.project_path, row.project_path);

    const sessionsPage = readProjectSessionsIncludingArchived(row.project_path);

    archivedProjects.push({
      projectId: row.project_id,
      path: row.project_path,
      displayName,
      fullPath: row.project_path,
      isStarred: Boolean(row.isStarred),
      isArchived: true,
      sessions: sessionsPage.sessions,
      sessionMeta: {
        hasMore: sessionsPage.hasMore,
        total: sessionsPage.total,
      },
    });
  }

  return archivedProjects;
}

/**
 * Loads one paginated session slice for a specific project id.
 */
export async function getProjectSessionsPage(
  projectId: string,
  options: SessionPaginationOptions = {},
): Promise<ProjectSessionsPageApiView> {
  const projectRow = projectsDb.getProjectById(projectId);
  if (!projectRow) {
    throw new AppError(`Project "${projectId}" was not found.`, {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  const sessionsPage = readProjectSessionsPageByPath(projectRow.project_path, options);
  return {
    projectId: projectRow.project_id,
    sessions: sessionsPage.sessions,
    sessionMeta: {
      hasMore: sessionsPage.hasMore,
      total: sessionsPage.total,
    },
  };
}
