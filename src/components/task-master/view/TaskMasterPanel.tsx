import { useCallback, useEffect, useRef, useState } from 'react';

import PRDEditor from '../../prd-editor';
import { useTaskMaster } from '../context/TaskMasterContext';
import { useProjectPrdFiles } from '../hooks/useProjectPrdFiles';
import type { PrdFile, TaskMasterTask, TaskSelection } from '../types';
import {
  startTaskImplementation,
  type TaskLaunchProgress,
  type TaskWorkflowCallbacks,
} from '../workflow';
import type { SettingsMainTab } from '../../settings/types/types';

import TaskBoard from './TaskBoard';
import TaskDetailModal from './TaskDetailModal';
import TaskIntakeWorkspace from './TaskIntakeWorkspace';
import TaskMasterSetupWorkspace from './TaskMasterSetupWorkspace';

type TaskMasterPanelProps = TaskWorkflowCallbacks & {
  isVisible: boolean;
  onShowSettings?: (tab?: SettingsMainTab) => void;
  workspaceRequest: number;
};

const PRD_SAVE_MESSAGE = 'PRD saved successfully!';

export default function TaskMasterPanel({
  isVisible,
  sendMessage,
  onSessionEstablished,
  onNavigateToSession,
  onSessionProcessing,
  onShowSettings,
  workspaceRequest,
}: TaskMasterPanelProps) {
  const {
    tasks,
    currentProject,
    projectTaskMaster,
    refreshTasks,
    refreshProjects,
    setCurrentProject,
  } = useTaskMaster();

  const [selectedTask, setSelectedTask] = useState<TaskMasterTask | null>(null);
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
  const [launchingTaskId, setLaunchingTaskId] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'board' | 'setup' | 'create'>('board');
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchProgress, setLaunchProgress] = useState<TaskLaunchProgress | null>(null);
  const [failedTask, setFailedTask] = useState<TaskMasterTask | null>(null);
  const launchControllerRef = useRef<AbortController | null>(null);
  const handledWorkspaceRequestRef = useRef(0);

  const [isPrdEditorOpen, setIsPrdEditorOpen] = useState(false);
  const [selectedPrd, setSelectedPrd] = useState<PrdFile | null>(null);

  const [prdNotification, setPrdNotification] = useState<string | null>(null);
  const notificationTimeoutRef = useRef<number | null>(null);

  const { prdFiles, refreshPrdFiles } = useProjectPrdFiles({ projectId: currentProject?.projectId });

  const showPrdNotification = useCallback((message: string) => {
    if (notificationTimeoutRef.current) {
      window.clearTimeout(notificationTimeoutRef.current);
    }

    setPrdNotification(message);

    notificationTimeoutRef.current = window.setTimeout(() => {
      setPrdNotification(null);
      notificationTimeoutRef.current = null;
    }, 3000);
  }, []);

  const refreshPrdData = useCallback(
    async (showNotification = false) => {
      await refreshPrdFiles();
      if (showNotification) {
        showPrdNotification(PRD_SAVE_MESSAGE);
      }
    },
    [refreshPrdFiles, showPrdNotification],
  );

  useEffect(() => {
    return () => {
      if (notificationTimeoutRef.current) {
        window.clearTimeout(notificationTimeoutRef.current);
      }
    };
  }, []);

  const hasTaskMaster = Boolean(
    projectTaskMaster?.hasTaskmaster
      || currentProject?.taskmaster?.hasTaskmaster
      || currentProject?.taskMasterConfigured,
  );

  useEffect(() => {
    if (workspaceRequest <= handledWorkspaceRequestRef.current) return;
    handledWorkspaceRequestRef.current = workspaceRequest;
    setWorkspaceMode(hasTaskMaster ? 'create' : 'setup');
  }, [hasTaskMaster, workspaceRequest]);

  useEffect(() => {
    setWorkspaceMode('board');
    setLaunchError(null);
    setFailedTask(null);
    launchControllerRef.current?.abort();
  }, [currentProject?.projectId]);

  const handleTaskClick = useCallback(
    (taskSelection: TaskSelection) => {
      const selectedId = String(taskSelection.id);

      if (!taskSelection.title) {
        const fullTask = tasks.find((task) => String(task.id) === selectedId) ?? null;
        if (fullTask) {
          setSelectedTask(fullTask);
          setIsTaskDetailOpen(true);
        }
        return;
      }

      setSelectedTask(taskSelection as TaskMasterTask);
      setIsTaskDetailOpen(true);
    },
    [tasks],
  );

  const handleStartImplementation = useCallback(async (task: TaskMasterTask) => {
    if (!currentProject || launchingTaskId) return;
    launchControllerRef.current?.abort();
    const controller = new AbortController();
    launchControllerRef.current = controller;
    setIsTaskDetailOpen(false);
    setLaunchingTaskId(String(task.id));
    setLaunchError(null);
    setFailedTask(null);
    setLaunchProgress({ stage: 'provider', message: 'Checking the provider configuration' });
    try {
      await startTaskImplementation({
        project: currentProject,
        task,
        sendMessage,
        onSessionEstablished,
        onNavigateToSession,
        onSessionProcessing,
        signal: controller.signal,
        onProgress: setLaunchProgress,
      });
      setIsTaskDetailOpen(false);
      setSelectedTask(null);
      await refreshTasks();
    } catch (error) {
      setLaunchError(
        controller.signal.aborted
          ? 'Task start was cancelled before completion.'
          : error instanceof Error ? error.message : 'Failed to start implementation.',
      );
      setFailedTask(task);
    } finally {
      if (launchControllerRef.current === controller) launchControllerRef.current = null;
      setLaunchingTaskId(null);
      setLaunchProgress(null);
    }
  }, [
    currentProject,
    launchingTaskId,
    onNavigateToSession,
    onSessionEstablished,
    onSessionProcessing,
    refreshTasks,
    sendMessage,
  ]);

  return (
    <>
      <div className={`h-full ${isVisible ? 'block' : 'hidden'}`}>
        <div className="flex h-full flex-col overflow-hidden">
          {workspaceMode === 'setup' && currentProject ? (
            <TaskMasterSetupWorkspace
              project={currentProject}
              onCancel={() => setWorkspaceMode('board')}
              onComplete={() => {
                void refreshProjects().then(() => {
                  setCurrentProject(currentProject);
                  return refreshTasks();
                });
                setWorkspaceMode('board');
              }}
            />
          ) : workspaceMode === 'create' && currentProject ? (
            <TaskIntakeWorkspace
              project={currentProject}
              sendMessage={sendMessage}
              onSessionEstablished={onSessionEstablished}
              onNavigateToSession={onNavigateToSession}
              onSessionProcessing={onSessionProcessing}
              onCancel={() => setWorkspaceMode('board')}
              onTaskCreated={() => { void refreshTasks(); }}
              onOpenAgentSettings={() => onShowSettings?.('agents')}
            />
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              {launchProgress && (
                <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4" role="status" aria-live="polite">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Starting task · {launchProgress.stage}</p>
                  <p className="mt-1 font-medium text-foreground">{launchProgress.message}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (launchProgress.sessionId) {
                          sendMessage({ type: 'chat.abort', sessionId: launchProgress.sessionId });
                        }
                        launchControllerRef.current?.abort();
                      }}
                      className="min-h-11 rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {launchError && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                  <span>{launchError}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setLaunchError(null); setFailedTask(null); }} className="min-h-11 rounded-lg border border-border px-3 py-2 font-medium text-foreground hover:bg-accent">Dismiss</button>
                    {failedTask && (
                      <button type="button" onClick={() => void handleStartImplementation(failedTask)} className="min-h-11 rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground hover:bg-primary/90">Retry</button>
                    )}
                  </div>
                </div>
              )}
              <TaskBoard
                tasks={tasks}
                onTaskClick={handleTaskClick}
                showParentTasks
                currentProject={currentProject}
                onOpenSetup={() => setWorkspaceMode('setup')}
                onOpenCreateTask={() => setWorkspaceMode('create')}
                onStartTask={(task) => { void handleStartImplementation(task); }}
                isStartingTask={launchingTaskId !== null}
                suppressStartAction={Boolean(launchProgress || launchError)}
                onShowPRDEditor={(prd) => {
                  setSelectedPrd(prd ?? null);
                  setIsPrdEditorOpen(true);
                }}
                existingPRDs={prdFiles}
                onRefreshPRDs={(showNotification = false) => {
                  void refreshPrdData(showNotification);
                }}
              />
            </div>
          )}
        </div>
      </div>

      <TaskDetailModal
        task={selectedTask}
        isOpen={isTaskDetailOpen}
        onClose={() => {
          setIsTaskDetailOpen(false);
          setSelectedTask(null);
        }}
        onStatusChange={() => {
          void refreshTasks();
        }}
        onTaskClick={handleTaskClick}
        onStartImplementation={(task) => {
          void handleStartImplementation(task);
        }}
        onOpenImplementation={(sessionId) => {
          setIsTaskDetailOpen(false);
          setSelectedTask(null);
          onNavigateToSession?.(sessionId);
        }}
        isStartingImplementation={Boolean(selectedTask && launchingTaskId === String(selectedTask.id))}
      />

      {isPrdEditorOpen && (
        <PRDEditor
          project={currentProject}
          projectPath={currentProject?.fullPath || currentProject?.path}
          onClose={() => {
            setIsPrdEditorOpen(false);
            setSelectedPrd(null);
          }}
          isNewFile={!selectedPrd?.isExisting}
          file={{
            name: selectedPrd?.name || 'prd.txt',
            content: selectedPrd?.content || '',
            isExisting: selectedPrd?.isExisting,
          }}
          onSave={async () => {
            setIsPrdEditorOpen(false);
            setSelectedPrd(null);
            await refreshPrdData(true);
            await refreshTasks();
          }}
        />
      )}

      {prdNotification && (
        <div className="animate-in slide-in-from-bottom-2 fixed bottom-4 right-4 z-50 duration-300">
          <div className="flex items-center gap-3 rounded-lg bg-green-600 px-4 py-3 text-white shadow-lg">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">{prdNotification}</span>
          </div>
        </div>
      )}
    </>
  );
}
