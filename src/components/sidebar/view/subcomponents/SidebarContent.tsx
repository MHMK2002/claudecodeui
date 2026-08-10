import { Activity, Clock3 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ScrollArea } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import type { SidebarSearchMode } from '../../types/types';
import { RECENT_WINDOW_OPTIONS_MINUTES } from '../../hooks/useSidebarController';

import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projects: Project[];
  recentProjects: Project[];
  recentSessionsCount: number;
  recentSessionsWindowMinutes: number;
  recentWindowMinutes: number;
  onRecentWindowMinutesChange: (minutes: number) => void;
  isRecentProjectsLoading: boolean;
  runningSessionsCount: number;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  areAllProjectsExpanded: boolean;
  canExpandAllProjects: boolean;
  onToggleAllProjects: () => void;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  currentVersion: string;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

// Compact label for a recent-chat time window. Falls back to a derived
// "<n>h" / "<n>d" string when the i18n key is missing.
function formatWindowLabel(minutes: number, t: TFunction): string {
  const key = `recent.window.${minutes}`;
  const fallback = minutes % 1440 === 0
    ? `${minutes / 1440}d`
    : `${Math.round(minutes / 60)}h`;
  return t(key, fallback);
}

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  projects,
  recentProjects,
  recentSessionsCount,
  recentSessionsWindowMinutes,
  recentWindowMinutes,
  onRecentWindowMinutesChange,
  isRecentProjectsLoading,
  runningSessionsCount,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  onRefresh,
  isRefreshing,
  areAllProjectsExpanded,
  canExpandAllProjects,
  onToggleAllProjects,
  onCreateProject,
  onCollapseSidebar,
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  currentVersion,
  onShowVersionModal,
  onShowSettings,
  projectListProps,
  t,
}: SidebarContentProps) {
  // On mobile the footer overlaps the on-screen keyboard, hiding the rename
  // input; drop it while a rename is in flight.
  const isRenamingOnMobile = isMobile && Boolean(
    projectListProps.editingProject || projectListProps.editingSession,
  );

  return (
    <div
      className="flex h-full flex-col bg-background/80 backdrop-blur-sm md:w-72 md:select-none"
      style={{}}
    >
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        projectsCount={projects.length}
        runningSessionsCount={runningSessionsCount}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onClearSearchFilter={onClearSearchFilter}
        searchMode={searchMode}
        onSearchModeChange={onSearchModeChange}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        areAllProjectsExpanded={areAllProjectsExpanded}
        canExpandAllProjects={canExpandAllProjects}
        onToggleAllProjects={onToggleAllProjects}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        t={t}
      />

      <ScrollArea className="flex-1 overflow-y-auto overscroll-contain md:px-1.5 md:py-2">
        {searchMode === 'recent' ? (
          <div className="space-y-2">
            <div className="mx-2 space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-3 py-2 shadow-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Clock3 className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate text-xs font-normal text-foreground">
                    {t('recent.title', 'Recent chats')}
                  </span>
                </div>
                <span
                  className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-normal text-primary"
                  title={t('recent.windowMinutes', {
                    defaultValue: '{{count}} minute window',
                    count: recentSessionsWindowMinutes,
                  })}
                >
                  {recentSessionsCount}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-[11px] text-muted-foreground">
                  {t('recent.windowLabel', 'Time window')}
                </span>
                <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
                  {RECENT_WINDOW_OPTIONS_MINUTES.map((minutes) => {
                    const active = minutes === recentWindowMinutes;
                    return (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() => onRecentWindowMinutesChange(minutes)}
                        aria-pressed={active}
                        className={cn(
                          'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                          active
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {formatWindowLabel(minutes, t)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {isRecentProjectsLoading ? (
              <div className="px-4 py-12 text-center md:py-8">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('recent.loading', 'Loading recent chats...')}
                </p>
              </div>
            ) : projectListProps.filteredProjects.length === 0 ? (
              <div className="px-4 py-12 text-center md:py-8">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-border/70 bg-muted/50 md:mb-3">
                  <Clock3 className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
                  {recentSessionsCount > 0
                    ? t('recent.noMatchingChats', 'No recent chats match this search')
                    : t('recent.emptyTitle', 'No recent chats')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {recentSessionsCount > 0
                    ? t('recent.tryDifferentSearch', 'Try a different search term.')
                    : t('recent.emptyDescription', 'Chats will appear here as soon as they become active.')}
                </p>
              </div>
            ) : (
              <SidebarProjectList
                {...projectListProps}
                projects={recentProjects}
                isLoading={false}
                loadingProgress={null}
              />
            )}
          </div>
        ) : searchMode === 'running' ? (
          projectListProps.filteredProjects.length === 0 ? (
            <div className="px-4 py-12 text-center md:py-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-border/70 bg-muted/50 md:mb-3">
                <Activity className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
                {t('running.emptyTitle', 'No sessions running')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {runningSessionsCount > 0
                  ? t('running.noMatchingSessions', 'No running sessions match this search.')
                  : t('running.emptyDescription', 'Active work will appear here while a provider is processing.')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="mx-2 flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-3 py-2 shadow-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Activity className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate text-xs font-normal text-foreground">
                    {t('running.title', 'Running now')}
                  </span>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-normal text-emerald-700 dark:text-emerald-300">
                  {runningSessionsCount}
                </span>
              </div>
              <SidebarProjectList {...projectListProps} />
            </div>
          )
        ) : (
          <SidebarProjectList {...projectListProps} />
        )}
      </ScrollArea>

      {!isRenamingOnMobile && (
        <SidebarFooter
          updateAvailable={updateAvailable}
          restartRequired={restartRequired}
          releaseInfo={releaseInfo}
          latestVersion={latestVersion}
          currentVersion={currentVersion}
          onShowVersionModal={onShowVersionModal}
          onShowSettings={onShowSettings}
          t={t}
        />
      )}
    </div>
  );
}
