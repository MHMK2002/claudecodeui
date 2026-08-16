import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { projectsDb } from '@/modules/database/index.js';
import type {
  CreateProjectPathResult,
  ProjectRepositoryRow,
  WorkspacePathValidationResult,
} from '@/shared/types.js';
import { AppError, normalizeProjectPath, validateWorkspacePath } from '@/shared/utils.js';

type CreateProjectInput = {
  projectPath: string;
  customName?: string | null;
};

type CreateProjectDependencies = {
  validatePath: (projectPath: string) => Promise<WorkspacePathValidationResult>;
  inspectWorkspaceDirectory: (
    projectPath: string,
  ) => Promise<'ready' | 'missing' | 'not_directory' | 'unwritable'>;
  persistProjectPath: (projectPath: string, customName: string | null) => CreateProjectPathResult;
  getProjectByPath: (projectPath: string) => ProjectRepositoryRow | null;
};

type ProjectApiView = {
  projectId: string;
  path: string;
  fullPath: string;
  displayName: string;
  customName: string | null;
  isArchived: boolean;
  isStarred: boolean;
  sessions: [];
  sessionMeta: {
    hasMore: false;
    total: 0;
  };
};

type CreateProjectServiceResult = {
  outcome: 'created' | 'reactivated_archived';
  project: ProjectApiView;
};

const defaultDependencies: CreateProjectDependencies = {
  validatePath: validateWorkspacePath,
  inspectWorkspaceDirectory: async (projectPath) => {
    try {
      const directoryStats = await fs.stat(projectPath);
      if (!directoryStats.isDirectory()) {
        return 'not_directory';
      }
      await fs.access(projectPath, fsConstants.R_OK | fsConstants.W_OK);
      return 'ready';
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') return 'missing';
      if (errorCode === 'EACCES' || errorCode === 'EPERM' || errorCode === 'EROFS') {
        return 'unwritable';
      }
      throw error;
    }
  },
  persistProjectPath: (projectPath: string, customName: string | null): CreateProjectPathResult =>
    projectsDb.createProjectPath(projectPath, customName),
  getProjectByPath: (projectPath: string): ProjectRepositoryRow | null =>
    projectsDb.getProjectPath(projectPath),
};

/**
 * Resolves an active registered project's stored directory for the WebSocket
 * Shell module. The shell performs the final realpath/directory check at PTY
 * creation time so moved or deleted projects become typed cwd failures.
 */
export function resolveActiveProjectDirectory(
  projectId: string,
  getProjectById: (id: string) => ProjectRepositoryRow | null = (id) => projectsDb.getProjectById(id),
): string | null {
  const project = getProjectById(projectId);
  if (!project || project.isArchived) {
    return null;
  }
  return normalizeProjectPath(project.project_path);
}

function resolveDisplayName(customName: string | null | undefined, projectPath: string): string {
  const trimmedCustomName = typeof customName === 'string' ? customName.trim() : '';
  if (trimmedCustomName.length > 0) {
    return trimmedCustomName;
  }

  return path.basename(projectPath) || projectPath;
}

function mapProjectRowToApiView(projectRow: ProjectRepositoryRow): ProjectApiView {
  return {
    projectId: projectRow.project_id,
    path: projectRow.project_path,
    fullPath: projectRow.project_path,
    displayName: resolveDisplayName(projectRow.custom_project_name, projectRow.project_path),
    customName: projectRow.custom_project_name,
    isArchived: Boolean(projectRow.isArchived),
    isStarred: Boolean(projectRow.isStarred),
    sessions: [],
    sessionMeta: {
      hasMore: false,
      total: 0,
    },
  };
}

export async function createProject(
  input: CreateProjectInput,
  dependencies: CreateProjectDependencies = defaultDependencies,
): Promise<CreateProjectServiceResult> {
  const normalizedPath = normalizeProjectPath(input.projectPath || '');
  if (!normalizedPath) {
    throw new AppError('path is required', {
      code: 'PROJECT_PATH_REQUIRED',
      statusCode: 400,
    });
  }

  const pathValidation = await dependencies.validatePath(normalizedPath);
  if (!pathValidation.valid || !pathValidation.resolvedPath) {
    throw new AppError('Invalid project path', {
      code: 'INVALID_PROJECT_PATH',
      statusCode: 400,
      details: {
        action: 'BROWSE',
        field: 'folder',
        reason: pathValidation.error ?? 'Path validation failed',
      },
    });
  }

  const resolvedProjectPath = normalizeProjectPath(pathValidation.resolvedPath);
  const directoryState = await dependencies.inspectWorkspaceDirectory(resolvedProjectPath);
  if (directoryState === 'missing' || directoryState === 'not_directory') {
    throw new AppError(
      directoryState === 'missing'
        ? 'The selected project folder does not exist.'
        : 'The selected project path is not a folder.',
      {
        code: 'INVALID_PROJECT_PATH',
        statusCode: 400,
        details: { action: 'BROWSE', field: 'folder' },
      },
    );
  }
  if (directoryState === 'unwritable') {
    throw new AppError('The selected project folder is not writable.', {
      code: 'PROJECT_PATH_NOT_WRITABLE',
      statusCode: 403,
      details: { action: 'CHOOSE_ANOTHER', field: 'folder' },
    });
  }

  const normalizedCustomName = resolveDisplayName(input.customName ?? null, resolvedProjectPath);
  const persistedProject = dependencies.persistProjectPath(resolvedProjectPath, normalizedCustomName);

  if (persistedProject.outcome === 'active_conflict') {
    throw new AppError('Project path already exists and is active', {
      code: 'PROJECT_ALREADY_EXISTS',
      statusCode: 409,
      details: {
        action: 'CHOOSE_ANOTHER',
        field: 'folder',
        projectPath: resolvedProjectPath,
      },
    });
  }

  const projectRow = persistedProject.project ?? dependencies.getProjectByPath(resolvedProjectPath);
  if (!projectRow) {
    throw new AppError('Failed to resolve project after creation', {
      code: 'PROJECT_CREATE_FAILED',
      statusCode: 500,
    });
  }

  // Archived rows intentionally remain archived when reused, as requested.
  return {
    outcome: persistedProject.outcome,
    project: mapProjectRowToApiView(projectRow),
  };
}

/**
 * Sets `projects.custom_project_name` for the given `projectId` (or clears it when empty).
 */
export function updateProjectDisplayName(projectId: string, newDisplayName: unknown): void {
  const trimmed = typeof newDisplayName === 'string' ? newDisplayName.trim() : '';
  projectsDb.updateCustomProjectNameById(projectId, trimmed.length > 0 ? trimmed : null);
}
