import { useState } from 'react';

import { cn } from '../../../lib/utils';
import { api } from '../../../utils/api';
import { useTaskMaster } from '../context/TaskMasterContext';
import { useTaskBoardState } from '../hooks/useTaskBoardState';
import type { PrdFile, TaskBoardView, TaskMasterProject, TaskMasterTask, TaskSelection } from '../types';

import TaskBoardContent from './TaskBoardContent';
import TaskBoardToolbar from './TaskBoardToolbar';
import TaskEmptyState from './TaskEmptyState';
import TaskHelpModal from './modals/TaskHelpModal';
import NextTaskBanner from './NextTaskBanner';

type TaskBoardProps = {
  tasks?: TaskMasterTask[];
  onTaskClick?: ((task: TaskSelection) => void) | null;
  className?: string;
  showParentTasks?: boolean;
  defaultView?: TaskBoardView;
  currentProject?: TaskMasterProject | null;
  onShowPRDEditor?: ((file?: PrdFile) => void) | null;
  existingPRDs?: PrdFile[];
  onRefreshPRDs?: ((showNotification?: boolean) => void) | null;
  onOpenSetup: () => void;
  onOpenCreateTask: () => void;
  onStartTask: (task: TaskMasterTask) => void;
  isStartingTask: boolean;
  suppressStartAction?: boolean;
};

export default function TaskBoard({
  tasks = [],
  onTaskClick = null,
  className = '',
  showParentTasks = false,
  defaultView = 'kanban',
  currentProject = null,
  onShowPRDEditor = null,
  existingPRDs = [],
  onRefreshPRDs = null,
  onOpenSetup,
  onOpenCreateTask,
  onStartTask,
  isStartingTask,
  suppressStartAction = false,
}: TaskBoardProps) {
  const { projectTaskMaster } = useTaskMaster();

  const [showHelpModal, setShowHelpModal] = useState(false);

  const {
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    priorityFilter,
    setPriorityFilter,
    sortField,
    setSortField,
    sortOrder,
    setSortOrder,
    viewMode,
    setViewMode,
    showFilters,
    setShowFilters,
    statuses,
    priorities,
    filteredTasks,
    kanbanColumns,
    handleSortChange,
    clearFilters,
  } = useTaskBoardState({ tasks, defaultView });

  const hasTaskMasterDirectory = Boolean(
    currentProject?.taskMasterConfigured
      || currentProject?.taskmaster?.hasTaskmaster
      || projectTaskMaster?.hasTaskmaster,
  );

  const loadPrdAndOpenEditor = async (prd: PrdFile) => {
    // Projects are addressed by DB projectId; see the projectName → projectId migration.
    if (!currentProject?.projectId) {
      return;
    }

    try {
      const response = await api.get(
        `/taskmaster/prd/${encodeURIComponent(currentProject.projectId)}/${encodeURIComponent(prd.name)}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to load PRD ${prd.name}`);
      }

      const data = (await response.json()) as { content?: string };
      onShowPRDEditor?.({
        name: prd.name,
        content: data.content ?? '',
        isExisting: true,
      });
    } catch (error) {
      console.error('Failed to open PRD in editor:', error);
    }
  };

  if (tasks.length === 0) {
    return (
      <>
        <TaskEmptyState
          className={className}
          hasTaskMasterDirectory={hasTaskMasterDirectory}
          existingPrds={existingPRDs}
          onOpenSetupModal={onOpenSetup}
          onCreatePrd={() => onShowPRDEditor?.()}
          onCreateTask={onOpenCreateTask}
          onOpenPrd={(prd) => {
            void loadPrdAndOpenEditor(prd);
          }}
        />

      </>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {filteredTasks.length > 0 && !isStartingTask && !suppressStartAction && (
        <NextTaskBanner
          onStartTask={onStartTask}
          isStartingTask={isStartingTask}
          actionEmphasis="primary"
        />
      )}
      <TaskBoardToolbar
        hasProject={Boolean(currentProject)}
        hasTaskMasterConfigured={hasTaskMasterDirectory}
        totalTaskCount={tasks.length}
        filteredTaskCount={filteredTasks.length}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((current) => !current)}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={setPriorityFilter}
        sortField={sortField}
        sortOrder={sortOrder}
        onSortChange={handleSortChange}
        onSortConfigChange={(field, order) => {
          setSortField(field);
          setSortOrder(order);
        }}
        statuses={statuses}
        priorities={priorities}
        onClearFilters={clearFilters}
        existingPrds={existingPRDs}
        onCreatePrd={() => onShowPRDEditor?.()}
        onOpenPrd={(prd) => {
          void loadPrdAndOpenEditor(prd);
        }}
        onOpenHelp={() => setShowHelpModal(true)}
        onOpenCreateTask={onOpenCreateTask}
      />

      <TaskBoardContent
        viewMode={viewMode}
        filteredTaskCount={filteredTasks.length}
        kanbanColumns={kanbanColumns}
        filteredTasks={filteredTasks}
        showParentTasks={showParentTasks}
        onTaskClick={(task) => onTaskClick?.(task)}
        onClearFilters={clearFilters}
      />

      <TaskHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        onCreatePrd={() => onShowPRDEditor?.()}
      />

    </div>
  );
}
