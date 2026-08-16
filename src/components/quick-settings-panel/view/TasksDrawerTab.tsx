import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Circle,
  CircleDot,
  ListChecks,
  Loader2,
  Play,
  Plus,
  RefreshCw,
} from 'lucide-react';

import { cn } from '../../../lib/utils';
import { useTaskMaster } from '../../task-master/context/TaskMasterContext';
import type { TaskMasterTask } from '../../task-master/types';
import {
  startTaskImplementation,
  type TaskWorkflowCallbacks,
} from '../../task-master/workflow';
import TaskDetailModal from '../../task-master/view/TaskDetailModal';

type TaskFilter = 'all' | 'ready' | 'running' | 'completed';
type TaskGroup = Exclude<TaskFilter, 'all'>;

const FILTERS: Array<{ id: TaskFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready' },
  { id: 'running', label: 'Running' },
  { id: 'completed', label: 'Done' },
];

function getTaskGroup(task: TaskMasterTask): TaskGroup {
  const status = task.status ?? 'pending';
  if (status === 'done' || status === 'cancelled') return 'completed';
  if (status === 'pending' || status === 'deferred') return 'ready';
  return 'running';
}

function getImplementationSessionId(task: TaskMasterTask): string | null {
  return typeof task.implementationSessionId === 'string'
    ? task.implementationSessionId
    : null;
}

type TasksDrawerTabProps = TaskWorkflowCallbacks & {
  onCreateTask: () => void;
};

export default function TasksDrawerTab({
  sendMessage,
  onSessionEstablished,
  onNavigateToSession,
  onSessionProcessing,
  onCreateTask,
}: TasksDrawerTabProps) {
  const {
    currentProject,
    projectTaskMaster,
    tasks,
    isLoadingTasks,
    error,
    refreshTasks,
  } = useTaskMaster();
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [selectedTask, setSelectedTask] = useState<TaskMasterTask | null>(null);
  const [launchingTaskId, setLaunchingTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const isConfigured = Boolean(
    projectTaskMaster?.hasTaskmaster
      || currentProject?.taskmaster?.hasTaskmaster
      || currentProject?.taskMasterConfigured,
  );

  const taskCounts = useMemo(() => {
    const counts: Record<TaskGroup, number> = {
      ready: 0,
      running: 0,
      completed: 0,
    };
    for (const task of tasks) counts[getTaskGroup(task)] += 1;
    return counts;
  }, [tasks]);

  const visibleTasks = useMemo(() => (
    filter === 'all' ? tasks : tasks.filter((task) => getTaskGroup(task) === filter)
  ), [filter, tasks]);

  const handleRun = async (task: TaskMasterTask) => {
    if (!currentProject || launchingTaskId) return;
    const taskId = String(task.id);
    setLaunchingTaskId(taskId);
    setActionError(null);
    try {
      await startTaskImplementation({
        project: currentProject,
        task,
        sendMessage,
        onSessionEstablished,
        onNavigateToSession,
        onSessionProcessing,
      });
      setSelectedTask(null);
      await refreshTasks();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Failed to start the task.');
    } finally {
      setLaunchingTaskId(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Project tasks</h3>
          <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
            {currentProject?.displayName ?? 'Choose a project'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void refreshTasks()}
            disabled={!currentProject || isLoadingTasks}
            aria-label="Refresh tasks"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-500 transition-colors hover:bg-gray-100 hover:text-blue-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-blue-400"
          >
            <RefreshCw className={cn('h-4 w-4', isLoadingTasks && 'animate-spin')} />
          </button>
          {tasks.length > 0 && (
            <button
              type="button"
              onClick={onCreateTask}
              disabled={!currentProject}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Create task
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 border-y border-gray-200 bg-gray-100 p-2 dark:border-gray-700 dark:bg-gray-800">
        {FILTERS.map(({ id, label }) => {
          const count = id === 'all' ? tasks.length : taskCounts[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={cn(
                'rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors',
                filter === id
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
              )}
            >
              {label} {count > 0 ? count : ''}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {actionError && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {actionError}
          </div>
        )}

        {error && tasks.length === 0 ? (
          <div className="py-10 text-center text-xs text-red-600 dark:text-red-400">{error.message}</div>
        ) : isLoadingTasks && tasks.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tasks…
          </div>
        ) : visibleTasks.length === 0 ? (
          <TaskEmptyState hasTasks={tasks.length > 0} isConfigured={isConfigured} onCreate={onCreateTask} />
        ) : (
          <div className="space-y-2">
            {visibleTasks.map((task) => (
              <TaskRow
                key={String(task.id)}
                task={task}
                isLaunching={launchingTaskId === String(task.id)}
                onOpen={() => setSelectedTask(task)}
                onRun={() => void handleRun(task)}
                onOpenSession={(sessionId) => onNavigateToSession?.(sessionId)}
              />
            ))}
          </div>
        )}
      </div>

      <TaskDetailModal
        task={selectedTask}
        isOpen={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
        onStartImplementation={(task) => void handleRun(task)}
        onOpenImplementation={(sessionId) => onNavigateToSession?.(sessionId)}
        isStartingImplementation={Boolean(
          selectedTask && launchingTaskId === String(selectedTask.id)
        )}
      />
    </div>
  );
}

type TaskRowProps = {
  task: TaskMasterTask;
  isLaunching: boolean;
  onOpen: () => void;
  onRun: () => void;
  onOpenSession: (sessionId: string) => void;
};

function TaskRow({ task, isLaunching, onOpen, onRun, onOpenSession }: TaskRowProps) {
  const group = getTaskGroup(task);
  const sessionId = getImplementationSessionId(task);
  const StatusIcon = group === 'completed'
    ? CheckCircle2
    : group === 'running'
      ? CircleDot
      : Circle;

  return (
    <article className="rounded-lg border border-gray-200 bg-white transition-all duration-200 hover:border-blue-300 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-600">
      <button type="button" onClick={onOpen} className="w-full px-3 py-2.5 text-left">
        <div className="flex items-start gap-2">
          <StatusIcon
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0',
              group === 'completed' && 'text-green-600 dark:text-green-400',
              group === 'running' && 'text-blue-600 dark:text-blue-400',
              group === 'ready' && 'text-slate-500 dark:text-slate-400',
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium leading-5 text-gray-900 dark:text-white">{task.title}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              <span>Task {String(task.id)}</span>
              <span>·</span>
              <span className="capitalize">{task.status ?? 'pending'}</span>
            </p>
          </div>
        </div>
      </button>

      <div className="flex items-center justify-end gap-1 border-t border-gray-200 px-2 py-1.5 dark:border-gray-700">
        {group === 'ready' && (
          <button
            type="button"
            onClick={onRun}
            disabled={isLaunching}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLaunching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {isLaunching ? 'Starting…' : 'Run'}
          </button>
        )}
        {sessionId && (
          <button
            type="button"
            onClick={() => onOpenSession(sessionId)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-blue-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-blue-400"
          >
            <ArrowUpRight className="h-3 w-3" />
            {group === 'completed' ? 'Result' : 'Session'}
          </button>
        )}
      </div>
    </article>
  );
}

function TaskEmptyState({
  hasTasks,
  isConfigured,
  onCreate,
}: {
  hasTasks: boolean;
  isConfigured: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400 dark:border-gray-700 dark:text-gray-500">
        <ListChecks className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-gray-900 dark:text-white">
        {hasTasks ? 'No tasks in this view' : isConfigured ? 'No tasks yet' : 'Tasks are not set up'}
      </p>
      {!hasTasks && (
        <>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {isConfigured
              ? 'Capture an idea, clarify it, and run it when you are ready.'
              : 'Set up TaskMaster for this project before creating tasks.'}
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            {isConfigured ? 'Create task' : 'Set up Tasks'}
          </button>
        </>
      )}
    </div>
  );
}
