import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';

import { api } from '../../../utils/api';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';
import type {
  DeleteProjectConfirmation,
  ProjectSortOrder,
  SidebarSearchMode,
  SessionDeleteConfirmation,
  SessionWithProvider,
  SubagentListItem,
} from '../types/types';
import {
  clearLegacyStarredProjectIds,
  filterRecentProjects,
  filterProjects,
  getAllSessions,
  mergeRecentProjectSnapshots,
  readLegacyStarredProjectIds,
  readProjectSortOrder,
  sortProjects,
} from '../utils/utils';

// selectable recent-chat windows (minutes): 1h, 6h, 12h, 2d
export const RECENT_WINDOW_OPTIONS_MINUTES = [60, 360, 720, 2880] as const;
const DEFAULT_RECENT_WINDOW_MINUTES = 720;
const SUBAGENT_POLL_INTERVAL_MS = 4000;

type UseSidebarControllerArgs = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeSessions: SessionActivityMap;
  isLoading: boolean;
  isMobile: boolean;
  t: TFunction;
  onRefresh: () => Promise<void> | void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onSessionDelete?: (sessionId: string) => void;
  onLoadMoreSessions?: (projectId: string) => Promise<void> | void;
  // `projectId` is the DB-assigned identifier; callbacks use that post-migration.
  onProjectDelete?: (projectId: string) => void;
  setCurrentProject: (project: Project) => void;
  setSidebarVisible: (visible: boolean) => void;
  sidebarVisible: boolean;
};

export function useSidebarController({
  projects,
  selectedProject,
  selectedSession: _selectedSession,
  activeSessions,
  isLoading,
  isMobile,
  t,
  onRefresh,
  onProjectSelect,
  onSessionSelect,
  onSessionDelete,
  onLoadMoreSessions,
  onProjectDelete,
  setCurrentProject,
  setSidebarVisible,
  sidebarVisible,
}: UseSidebarControllerArgs) {
  const paletteOps = usePaletteOps();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [subagentsBySessionId, setSubagentsBySessionId] = useState<Map<string, SubagentListItem[]>>(new Map());
  const [loadedSubagentSessionIds, setLoadedSubagentSessionIds] = useState<Set<string>>(new Set());
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [initialSessionsLoaded, setInitialSessionsLoaded] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(new Date());
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('name');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [deletingProjects, setDeletingProjects] = useState<Set<string>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteProjectConfirmation | null>(null);
  const [sessionDeleteConfirmation, setSessionDeleteConfirmation] = useState<SessionDeleteConfirmation | null>(null);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [searchMode, setSearchMode] = useState<SidebarSearchMode>('recent');
  const [recentWindowMinutes, setRecentWindowMinutes] = useState<number>(DEFAULT_RECENT_WINDOW_MINUTES);
  const [recentProjectSnapshots, setRecentProjectSnapshots] = useState<Project[]>([]);
  const [isRecentProjectsLoading, setIsRecentProjectsLoading] = useState(true);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [optimisticStarByProjectId, setOptimisticStarByProjectId] = useState<Map<string, boolean>>(new Map());
  const [loadingMoreProjects, setLoadingMoreProjects] = useState<Set<string>>(new Set());
  const starToggleSequenceByProjectRef = useRef<Map<string, number>>(new Map());
  const migrationStartedRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  const isSidebarCollapsed = !isMobile && !sidebarVisible;
  const activeSessionIds = useMemo(() => new Set(activeSessions.keys()), [activeSessions]);
  const runningSessionsCount = activeSessionIds.size;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setInitialSessionsLoaded(new Set());
  }, [projects]);

  useEffect(() => {
    // Auto-expand only when the selected project identity changes.
    // Depending on the full `selectedProject` object (or `selectedSession`) causes
    // websocket-driven list refreshes to re-open projects users manually collapsed.
    const selectedProjectId = selectedProject?.projectId;
    if (!selectedProjectId) {
      return;
    }

    setExpandedProjects((prev) => {
      if (prev.has(selectedProjectId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(selectedProjectId);
      return next;
    });
  }, [selectedProject?.projectId]);

  useEffect(() => {
    if (projects.length > 0 && !isLoading) {
      const loadedProjects = new Set<string>();
      projects.forEach((project) => {
        if (project.sessions && project.sessions.length >= 0) {
          loadedProjects.add(project.projectId);
        }
      });
      setInitialSessionsLoaded(loadedProjects);
    }
  }, [projects, isLoading]);

  useEffect(() => {
    const loadSortOrder = () => {
      setProjectSortOrder(readProjectSortOrder());
    };

    loadSortOrder();

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'claude-settings') {
        loadSortOrder();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    const interval = setInterval(() => {
      if (document.hasFocus()) {
        loadSortOrder();
      }
    }, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const fetchRecentProjects = useCallback(async () => {
    setIsRecentProjectsLoading(true);

    try {
      const response = await api.recentProjects({
        windowMinutes: recentWindowMinutes,
        skipSynchronization: true,
      });
      if (!response.ok) {
        throw new Error(`Failed to load recent sessions: ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      setRecentProjectSnapshots(Array.isArray(payload) ? payload as Project[] : []);
    } catch (error) {
      console.error('[Sidebar] Failed to load recent sessions:', error);
    } finally {
      setIsRecentProjectsLoading(false);
    }
  }, [recentWindowMinutes]);

  useEffect(() => {
    if (migrationStartedRef.current) {
      return;
    }

    const legacyStarredProjectIds = readLegacyStarredProjectIds();
    if (legacyStarredProjectIds.length === 0) {
      return;
    }

    migrationStartedRef.current = true;

    const migrateLegacyStars = async () => {
      try {
        await api.migrateLegacyProjectStars(legacyStarredProjectIds);
        await onRefreshRef.current();
      } catch (error) {
        console.error('[Sidebar] Failed to migrate legacy starred projects:', error);
      } finally {
        clearLegacyStarredProjectIds();
      }
    };

    void migrateLegacyStars();
  }, [onRefresh]);

  useEffect(() => {
    if (searchMode !== 'recent' || isLoading) {
      return;
    }

    // The main project request performs provider synchronization first. The
    // recent endpoint can therefore use its cheap DB-only path here.
    void fetchRecentProjects();
  }, [fetchRecentProjects, isLoading, searchMode]);

  useEffect(() => {
    setOptimisticStarByProjectId((previous) => {
      if (previous.size === 0) {
        return previous;
      }

      const next = new Map(previous);
      let changed = false;

      for (const [projectId, optimisticValue] of previous.entries()) {
        const project = projects.find((candidate) => candidate.projectId === projectId);
        if (!project) {
          next.delete(projectId);
          changed = true;
          continue;
        }

        if (Boolean(project.isStarred) === optimisticValue) {
          next.delete(projectId);
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [projects]);

  // Debounce search text updates so project filtering avoids running on every
  // keypress.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchQuery(searchFilter.trim());
    }, 300);

    return () => {
      clearTimeout(timeout);
    };
  }, [searchFilter]);

  // All sidebar state keys (expanded, starred, loading, etc.) use the DB
  // `projectId` as their identifier after the migration.
  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects((prev) => {
      // Independent per-project toggle: copy the existing set so collapsing
      // one project doesn't collapse the others. (Previously this built a
      // fresh empty set, producing accidental accordion behavior and
      // breaking collapse in the Recent tab.)
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const handleSessionClick = useCallback(
    (session: SessionWithProvider, projectId: string) => {
      // Tag the session with its owning projectId so downstream handlers
      // can correlate it with the selectedProject in the app state.
      onSessionSelect({ ...session, __projectId: projectId });
    },
    [onSessionSelect],
  );

  /**
   * Loads the sub-agents of one session into the cache.
   *
   * Failures leave the previous entry untouched rather than clearing it, so a
   * dropped poll never blanks an already-rendered agent list.
   */
  const loadSubagents = useCallback(async (sessionId: string) => {
    try {
      const response = await api.sessionSubagents(sessionId);
      if (!response.ok) {
        return;
      }

      const body = await response.json();
      const subagents: SubagentListItem[] = body?.data?.subagents ?? body?.subagents ?? [];
      setSubagentsBySessionId((previous) => new Map(previous).set(sessionId, subagents));
    } catch (error) {
      console.error(`[Sidebar] failed to load sub-agents for ${sessionId}:`, error);
    } finally {
      setLoadedSubagentSessionIds((previous) => new Set(previous).add(sessionId));
    }
  }, []);

  const toggleSessionAgents = useCallback((sessionId: string) => {
    setExpandedSessions((previous) => {
      const next = new Set(previous);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
        void loadSubagents(sessionId);
      }
      return next;
    });
  }, [loadSubagents]);

  // Agents of a *running* session change while the user watches, so expanded
  // rows re-poll. Idle sessions are fetched once on expand — their transcripts
  // are final, and polling them would be pure I/O for an unchanged answer.
  useEffect(() => {
    const pollableSessionIds = [...expandedSessions].filter((sessionId) => activeSessionIds.has(sessionId));
    if (pollableSessionIds.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      for (const sessionId of pollableSessionIds) {
        void loadSubagents(sessionId);
      }
    }, SUBAGENT_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [expandedSessions, activeSessionIds, loadSubagents]);

  const resolveProjectStarState = useCallback(
    (projectId: string): boolean => {
      if (optimisticStarByProjectId.has(projectId)) {
        return Boolean(optimisticStarByProjectId.get(projectId));
      }

      return projects.some((project) => project.projectId === projectId && Boolean(project.isStarred));
    },
    [optimisticStarByProjectId, projects],
  );

  const toggleStarProject = useCallback((projectId: string) => {
    const previousStarState = resolveProjectStarState(projectId);
    const optimisticStarState = !previousStarState;
    const latestSequence = (starToggleSequenceByProjectRef.current.get(projectId) ?? 0) + 1;
    starToggleSequenceByProjectRef.current.set(projectId, latestSequence);

    setOptimisticStarByProjectId((previous) => {
      const next = new Map(previous);
      next.set(projectId, optimisticStarState);
      return next;
    });

    const updateStar = async () => {
      try {
        const response = await api.toggleProjectStar(projectId);
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string | { message?: string } };
          const errorPayload = payload.error;
          const message =
            typeof errorPayload === 'string'
              ? errorPayload
              : errorPayload && typeof errorPayload === 'object' && errorPayload.message
                ? errorPayload.message
                : t('messages.updateProjectError');
          throw new Error(message);
        }

        const payload = (await response.json()) as { isStarred?: boolean };
        const isLatestSequence = starToggleSequenceByProjectRef.current.get(projectId) === latestSequence;
        if (!isLatestSequence) {
          return;
        }

        setOptimisticStarByProjectId((previous) => {
          const next = new Map(previous);
          next.set(projectId, Boolean(payload.isStarred));
          return next;
        });
      } catch (error) {
        const isLatestSequence = starToggleSequenceByProjectRef.current.get(projectId) === latestSequence;
        if (!isLatestSequence) {
          return;
        }

        setOptimisticStarByProjectId((previous) => {
          const next = new Map(previous);
          next.set(projectId, previousStarState);
          return next;
        });
        console.error('[Sidebar] Failed to toggle project star:', error);
        alert(t('messages.updateProjectError'));
      }
    };

    void updateStar();
  }, [resolveProjectStarState, t]);

  const isProjectStarred = useCallback(
    (projectId: string) => resolveProjectStarState(projectId),
    [resolveProjectStarState],
  );

  const getProjectSessions = useCallback((project: Project) => getAllSessions(project), []);

  const loadMoreSessionsForProject = useCallback(async (projectId: string) => {
    if (!onLoadMoreSessions) {
      return;
    }

    let shouldLoad = false;
    setLoadingMoreProjects((previous) => {
      if (previous.has(projectId)) {
        return previous;
      }

      shouldLoad = true;
      const next = new Set(previous);
      next.add(projectId);
      return next;
    });

    if (!shouldLoad) {
      return;
    }

    try {
      await onLoadMoreSessions(projectId);
    } catch (error) {
      console.error('[Sidebar] Failed to load more sessions:', error);
      alert(t('messages.refreshError'));
    } finally {
      setLoadingMoreProjects((previous) => {
        const next = new Set(previous);
        next.delete(projectId);
        return next;
      });
    }
  }, [onLoadMoreSessions, t]);

  const projectsWithResolvedStarState = useMemo(() => {
    if (optimisticStarByProjectId.size === 0) {
      return projects;
    }

    return projects.map((project) => {
      const optimisticStarState = optimisticStarByProjectId.get(project.projectId);
      if (optimisticStarState === undefined) {
        return project;
      }

      const currentStarState = Boolean(project.isStarred);
      if (currentStarState === optimisticStarState) {
        return project;
      }

      return {
        ...project,
        isStarred: optimisticStarState,
      };
    });
  }, [optimisticStarByProjectId, projects]);

  const sortedProjects = useMemo(
    () => sortProjects(projectsWithResolvedStarState, projectSortOrder),
    [projectSortOrder, projectsWithResolvedStarState],
  );

  const recentProjects = useMemo(
    () => mergeRecentProjectSnapshots(
      projectsWithResolvedStarState,
      recentProjectSnapshots,
      currentTime,
      recentWindowMinutes,
    ),
    [currentTime, projectsWithResolvedStarState, recentProjectSnapshots, recentWindowMinutes],
  );

  const runningProjects = useMemo(() => {
    if (activeSessionIds.size === 0) {
      return [];
    }

    return sortedProjects.reduce<Project[]>((acc, project) => {
      const sessions = (project.sessions ?? []).filter((session) => activeSessionIds.has(String(session.id)));
      const runningCount = sessions.length;

      if (runningCount === 0) {
        return acc;
      }

      acc.push({
        ...project,
        sessions,
        sessionMeta: {
          ...project.sessionMeta,
          total: runningCount,
          hasMore: false,
        },
      });
      return acc;
    }, []);
  }, [activeSessionIds, sortedProjects]);

  const filteredProjects = useMemo(() => {
    if (searchMode === 'recent') {
      return filterRecentProjects(recentProjects, debouncedSearchQuery);
    }

    return filterProjects(searchMode === 'running' ? runningProjects : sortedProjects, debouncedSearchQuery);
  }, [debouncedSearchQuery, recentProjects, runningProjects, searchMode, sortedProjects]);

  // "Expand all / collapse all" acts on the list the user is actually looking at
  // (the current tab's filtered projects), leaving the expansion state of projects
  // hidden by the filter untouched.
  const visibleProjectIds = useMemo(
    () => filteredProjects.map((project) => project.projectId),
    [filteredProjects],
  );

  const canExpandAllProjects = visibleProjectIds.length > 0;

  const areAllProjectsExpanded = useMemo(
    () => canExpandAllProjects && visibleProjectIds.every((projectId) => expandedProjects.has(projectId)),
    [canExpandAllProjects, expandedProjects, visibleProjectIds],
  );

  const toggleAllProjects = useCallback(() => {
    setExpandedProjects((prev) => {
      if (visibleProjectIds.length === 0) {
        return prev;
      }

      const allExpanded = visibleProjectIds.every((projectId) => prev.has(projectId));
      const next = new Set(prev);
      for (const projectId of visibleProjectIds) {
        if (allExpanded) {
          next.delete(projectId);
        } else {
          next.add(projectId);
        }
      }
      return next;
    });
  }, [visibleProjectIds]);

  const startEditing = useCallback((project: Project) => {
    // `editingProject` is keyed by projectId so it stays stable across
    // display-name mutations that happen while the input is open.
    setEditingProject(project.projectId);
    setEditingName(project.displayName);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingProject(null);
    setEditingName('');
  }, []);

  const saveProjectName = useCallback(
    // `projectId` is the DB primary key; the rename API resolves the path
    // through the `projects` table before writing the new display name.
    async (projectId: string) => {
      try {
        const response = await api.renameProject(projectId, editingName);
        if (response.ok) {
          await paletteOps.refreshProjects();
        } else {
          console.error('Failed to rename project');
        }
      } catch (error) {
        console.error('Error renaming project:', error);
      } finally {
        setEditingProject(null);
        setEditingName('');
      }
    },
    [editingName, paletteOps],
  );

  const showDeleteSessionConfirmation = useCallback(
    // Kept with project/provider arguments for component wiring compatibility;
    // deletion now uses only `sessionId` via /api/providers/sessions/:sessionId.
    (
      projectId: string | null,
      sessionId: string,
      sessionTitle: string,
      provider: SessionDeleteConfirmation['provider'] = 'claude',
      options: {
        isArchived?: boolean;
      } = {},
    ) => {
      setSessionDeleteConfirmation({
        projectId,
        sessionId,
        sessionTitle,
        provider,
        isArchived: Boolean(options.isArchived),
      });
    },
    [],
  );

  const confirmDeleteSession = useCallback(async (hardDelete = false) => {
    if (!sessionDeleteConfirmation) {
      return;
    }

    const { sessionId } = sessionDeleteConfirmation;
    setSessionDeleteConfirmation(null);

    try {
      const response = await api.deleteSession(sessionId, hardDelete);

      if (response.ok) {
        onSessionDelete?.(sessionId);
        await fetchRecentProjects();
      } else {
        const errorText = await response.text();
        console.error('[Sidebar] Failed to delete session:', {
          status: response.status,
          error: errorText,
        });
        alert(t('messages.deleteSessionFailed'));
      }
    } catch (error) {
      console.error('[Sidebar] Error deleting session:', error);
      alert(t('messages.deleteSessionError'));
    }
  }, [fetchRecentProjects, onSessionDelete, sessionDeleteConfirmation, t]);

  const requestProjectDelete = useCallback(
    (project: Project) => {
      setDeleteConfirmation({
        project,
        sessionCount: getProjectSessions(project).length,
      });
    },
    [getProjectSessions],
  );

  const confirmDeleteProject = useCallback(async (deleteData = false) => {
    if (!deleteConfirmation) {
      return;
    }

    const { project } = deleteConfirmation;

    setDeleteConfirmation(null);
    // Track in-flight deletes by projectId so the UI can disable actions
    // even if the project object is rebuilt while the request is flying.
    setDeletingProjects((prev) => new Set([...prev, project.projectId]));

    try {
      const response = await api.deleteProject(project.projectId, deleteData);

      if (response.ok) {
        onProjectDelete?.(project.projectId);
        await fetchRecentProjects();
      } else {
        const data = (await response.json()) as { error?: string | { message?: string } };
        const err = data.error;
        const message =
          typeof err === 'string' ? err : err && typeof err === 'object' && err.message ? err.message : t('messages.deleteProjectFailed');
        alert(message);
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      alert(t('messages.deleteProjectError'));
    } finally {
      setDeletingProjects((prev) => {
        const next = new Set(prev);
        next.delete(project.projectId);
        return next;
      });
    }
  }, [deleteConfirmation, fetchRecentProjects, onProjectDelete, t]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      onProjectSelect(project);
      setCurrentProject(project);
    },
    [onProjectSelect, setCurrentProject],
  );

  const refreshProjects = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Let the full refresh synchronize provider sessions before reading the
      // lightweight DB-only recent view.
      await Promise.resolve(onRefresh());
      await fetchRecentProjects();
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchRecentProjects, onRefresh]);

  const updateSessionSummary = useCallback(
    // `_projectId` and `_provider` are preserved for compatibility with
    // existing sidebar callback signatures; backend rename only needs sessionId.
    async (_projectId: string, sessionId: string, summary: string, _provider: LLMProvider) => {
      const trimmed = summary.trim();
      if (!trimmed) {
        setEditingSession(null);
        setEditingSessionName('');
        return;
      }
      try {
        const response = await api.renameSession(sessionId, trimmed);
        if (response.ok) {
          await onRefresh();
          await fetchRecentProjects();
        } else {
          console.error('[Sidebar] Failed to rename session:', response.status);
          alert(t('messages.renameSessionFailed'));
        }
      } catch (error) {
        console.error('[Sidebar] Error renaming session:', error);
        alert(t('messages.renameSessionError'));
      } finally {
        setEditingSession(null);
        setEditingSessionName('');
      }
    },
    [fetchRecentProjects, onRefresh, t],
  );

  const collapseSidebar = useCallback(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  const expandSidebar = useCallback(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  return {
    isSidebarCollapsed,
    expandedProjects,
    expandedSessions,
    subagentsBySessionId,
    loadedSubagentSessionIds,
    toggleSessionAgents,
    editingProject,
    showNewProject,
    editingName,
    initialSessionsLoaded,
    currentTime,
    projectSortOrder,
    isRefreshing,
    editingSession,
    editingSessionName,
    searchFilter,
    deletingProjects,
    loadingMoreProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    filteredProjects,
    recentProjects,
    recentSessionsCount: recentProjects.reduce((count, project) => count + (project.sessions?.length ?? 0), 0),
    recentSessionsWindowMinutes: recentWindowMinutes,
    recentWindowMinutes,
    setRecentWindowMinutes,
    isRecentProjectsLoading,
    runningSessionsCount,
    toggleProject,
    areAllProjectsExpanded,
    canExpandAllProjects,
    toggleAllProjects,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    getProjectSessions,
    loadMoreSessionsForProject,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    requestProjectDelete,
    confirmDeleteProject,
    handleProjectSelect,
    refreshProjects,
    updateSessionSummary,
    collapseSidebar,
    expandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    searchMode,
    setSearchMode,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  };
}
