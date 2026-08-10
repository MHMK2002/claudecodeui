import { useCallback, useEffect, useRef, useState } from 'react';

import PRDEditor from '../../prd-editor';
import { useTaskMaster } from '../context/TaskMasterContext';
import { useProjectPrdFiles } from '../hooks/useProjectPrdFiles';
import type { PrdFile, TaskMasterTask, TaskSelection } from '../types';
import { startTaskImplementation, type TaskWorkflowCallbacks } from '../workflow';

import TaskBoard from './TaskBoard';
import TaskDetailModal from './TaskDetailModal';

type TaskMasterPanelProps = TaskWorkflowCallbacks & {
  isVisible: boolean;
};

const PRD_SAVE_MESSAGE = 'PRD saved successfully!';

export default function TaskMasterPanel({
  isVisible,
  sendMessage,
  onSessionEstablished,
  onNavigateToSession,
  onSessionProcessing,
}: TaskMasterPanelProps) {
  const { tasks, currentProject, refreshTasks } = useTaskMaster();

  const [selectedTask, setSelectedTask] = useState<TaskMasterTask | null>(null);
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
  const [launchingTaskId, setLaunchingTaskId] = useState<string | null>(null);

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
    setLaunchingTaskId(String(task.id));
    try {
      await startTaskImplementation({
        project: currentProject,
        task,
        sendMessage,
        onSessionEstablished,
        onNavigateToSession,
        onSessionProcessing,
      });
      setIsTaskDetailOpen(false);
      setSelectedTask(null);
      await refreshTasks();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to start implementation.');
    } finally {
      setLaunchingTaskId(null);
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
          <TaskBoard
            tasks={tasks}
            onTaskClick={handleTaskClick}
            showParentTasks
            className="flex-1 overflow-y-auto p-4"
            currentProject={currentProject}
            onTaskCreated={refreshTasks}
            sendMessage={sendMessage}
            onSessionEstablished={onSessionEstablished}
            onNavigateToSession={onNavigateToSession}
            onSessionProcessing={onSessionProcessing}
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
