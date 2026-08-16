import React, { useCallback, useEffect, useMemo, useState } from 'react';

import ChatInterface from '../../chat/view/ChatInterface';
import FileTree from '../../file-tree/view/FileTree';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import GitPanel from '../../git-panel/view/GitPanel';
import PluginTabContent from '../../plugins/view/PluginTabContent';
import { BrowserUsePanel } from '../../browser-use';
import type { MainContentProps } from '../types/types';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { authenticatedFetch } from '../../../utils/api';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import type { Project } from '../../../types/app';
import { TaskMasterPanel } from '../../task-master';
import { useSubagentTranscript } from '../hooks/useSubagentTranscript';
import { useSessionStore } from '../../../stores/useSessionStore';
import ScheduleEditorWorkspace from '../../scheduled-runs/ScheduleEditorWorkspace';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

type TaskMasterContextValue = {
  currentProject?: Project | null;
  setCurrentProject?: ((project: Project) => void) | null;
};

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
};

function MainContent({
  selectedProject,
  selectedSession,
  selectedSubagentSessionId,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
  onProjectSelect,
  onProjectsRefresh,
  taskWorkspaceRequest,
  scheduleWorkspaceRequest,
  onCloseScheduleWorkspace,
}: MainContentProps) {
  const sessionStore = useSessionStore();
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter } = preferences;

  const { currentProject, setCurrentProject } = useTaskMaster() as TaskMasterContextValue;
  const { tasksEnabled } = useTasksSettings() as TasksSettingsContextValue;
  const [browserUseEnabled, setBrowserUseEnabled] = useState(false);
  const selectedSubagentState = useSubagentTranscript(
    selectedSession?.id ?? null,
    selectedSubagentSessionId,
  );
  const selectedSubagent = selectedSubagentState.transcript;

  // Chat's existing history machinery consumes a ProjectSession-shaped
  // target. Keep that adapter local to the transcript surface: application
  // selection and every non-chat tab continue to use the root parent session.
  const transcriptSession = useMemo(() => {
    if (!selectedSubagent) {
      return selectedSession;
    }

    return {
      id: selectedSubagent.sessionId,
      summary: selectedSubagent.name,
      provider: selectedSubagent.provider,
      __provider: selectedSubagent.provider,
      parentSessionId: selectedSubagent.parentSessionId,
      agentType: selectedSubagent.agentType,
      __projectId: selectedSession?.__projectId,
    };
  }, [selectedSession, selectedSubagent]);

  const isSubagentViewPending = Boolean(
    selectedSubagentSessionId
    && (!selectedSession || selectedSubagentState.status === 'idle' || selectedSubagentState.status === 'loading'),
  );
  const isSubagentViewInvalid = Boolean(
    selectedSubagentSessionId
    && (selectedSubagentState.status === 'not-found' || selectedSubagentState.status === 'error'),
  );

  // Task setup is itself a valid Tasks workspace state, so the tab must stay
  // reachable before the optional TaskMaster CLI/runtime is installed.
  const shouldShowTasksTab = Boolean(tasksEnabled);
  const shouldShowBrowserTab = browserUseEnabled;

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  // Resolves bare/partial file references (e.g. links inside chat messages) to
  // real project files before opening them in the in-app editor.
  const resolvedFileOpen = useFileOpenResolver(selectedProject, handleFileOpen);

  useEffect(() => {
    // Identify projects by DB `projectId`; the TaskMaster context uses the
    // same identifier to key its internal maps.
    const selectedProjectId = selectedProject?.projectId;
    const currentProjectId = currentProject?.projectId;

    if (selectedProject && selectedProjectId !== currentProjectId) {
      setCurrentProject?.(selectedProject);
    }
  }, [selectedProject, currentProject?.projectId, setCurrentProject]);

  useEffect(() => {
    if (!shouldShowTasksTab && activeTab === 'tasks') {
      setActiveTab('chat');
    }
  }, [shouldShowTasksTab, activeTab, setActiveTab]);

  const loadBrowserUseSettings = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/browser-use/settings');
      const data = await response.json();
      setBrowserUseEnabled(Boolean(response.ok && data?.success !== false && data?.data?.settings?.enabled));
    } catch {
      setBrowserUseEnabled(false);
    }
  }, []);

  useEffect(() => {
    void loadBrowserUseSettings();
    window.addEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
    return () => window.removeEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
  }, [loadBrowserUseSettings]);

  useEffect(() => {
    if (!shouldShowBrowserTab && activeTab === 'browser') {
      setActiveTab('chat');
    }
  }, [shouldShowBrowserTab, activeTab, setActiveTab]);

  usePaletteOpsRegister({
    openFile: (filePath: string) => {
      setActiveTab('files');
      handleFileOpen(filePath);
    },
    // Opens the editor side panel in place, keeping the current tab (e.g. chat).
    openFileInEditor: (filePath: string) => {
      resolvedFileOpen(filePath);
    },
  });

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  return (
    <div className="flex h-full flex-col">
      <MainContentHeader
        sessionStore={sessionStore}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        selectedSubagent={selectedSubagent}
        shouldShowTasksTab={shouldShowTasksTab}
        shouldShowBrowserTab={shouldShowBrowserTab}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        onNavigateToSession={onNavigateToSession}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`flex min-h-0 min-w-[200px] flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            {isSubagentViewPending ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading agent transcript…
              </div>
            ) : isSubagentViewInvalid ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <span>Agent transcript was not found under this session.</span>
                {selectedSession && (
                  <button
                    type="button"
                    className="rounded-md bg-accent px-3 py-1.5 font-medium text-foreground"
                    onClick={() => onNavigateToSession(selectedSession.id, { replace: true })}
                  >
                    Back to parent session
                  </button>
                )}
              </div>
            ) : (
            <ErrorBoundary showDetails>
              <ChatInterface
                sessionStore={sessionStore}
                selectedProject={selectedProject}
                selectedSession={transcriptSession}
                ws={ws}
                sendMessage={sendMessage}
                onFileOpen={handleFileOpen}
                onInputFocusChange={onInputFocusChange}
                onSessionProcessing={onSessionProcessing}
                onSessionIdle={onSessionIdle}
                processingSessions={processingSessions}
                onNavigateToSession={onNavigateToSession}
                onSessionEstablished={onSessionEstablished}
                onShowSettings={onShowSettings}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                sendByCtrlEnter={sendByCtrlEnter}
                externalMessageUpdate={externalMessageUpdate}
                newSessionTrigger={newSessionTrigger}
                onShowAllTasks={tasksEnabled ? () => setActiveTab('tasks') : null}
              />
            </ErrorBoundary>
            )}
          </div>

          {activeTab === 'files' && (
            <div className="h-full overflow-hidden">
              <FileTree selectedProject={selectedProject} onFileOpen={handleFileOpen} />
            </div>
          )}

          {activeTab === 'shell' && (
            <div className="h-full w-full overflow-hidden">
              <StandaloneShell
                project={selectedProject}
                showHeader={false}
                isActive={activeTab === 'shell'}
              />
            </div>
          )}

          {activeTab === 'git' && (
            <div className="h-full overflow-hidden">
              <GitPanel
                selectedProject={selectedProject}
                isMobile={isMobile}
                onFileOpen={handleFileOpen}
                onProjectSelect={onProjectSelect}
                onProjectsRefresh={onProjectsRefresh}
                onShowSettings={onShowSettings}
              />
            </div>
          )}

          {shouldShowTasksTab && (
            <TaskMasterPanel
              isVisible={activeTab === 'tasks'}
              sendMessage={sendMessage}
              onSessionEstablished={onSessionEstablished}
              onNavigateToSession={(sessionId) => onNavigateToSession(sessionId)}
              onSessionProcessing={onSessionProcessing}
              onShowSettings={onShowSettings}
              workspaceRequest={taskWorkspaceRequest}
            />
          )}

          {activeTab === 'schedules' && (
            <ScheduleEditorWorkspace
              key={`${selectedProject.projectId}:${scheduleWorkspaceRequest?.requestId ?? 0}`}
              project={selectedProject}
              editingSchedule={scheduleWorkspaceRequest?.schedule ?? null}
              onClose={onCloseScheduleWorkspace}
              onOpenAgentSettings={() => onShowSettings('agents')}
            />
          )}

          {shouldShowBrowserTab && activeTab === 'browser' && (
            <div className="h-full overflow-hidden">
              <BrowserUsePanel isVisible={activeTab === 'browser'} onShowSettings={onShowSettings} />
            </div>
          )}

          {activeTab.startsWith('plugin:') && (
            <div className="h-full overflow-hidden">
              <PluginTabContent
                pluginName={activeTab.replace('plugin:', '')}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
              />
            </div>
          )}
        </div>

        {activeTab !== 'schedules' && (
          <EditorSidebar
            editingFile={editingFile}
            isMobile={isMobile}
            editorExpanded={editorExpanded}
            editorWidth={editorWidth}
            hasManualWidth={hasManualWidth}
            resizeHandleRef={resizeHandleRef}
            onResizeStart={handleResizeStart}
            onCloseEditor={handleCloseEditor}
            onToggleEditorExpand={handleToggleEditorExpand}
            projectPath={selectedProject.path}
            fillSpace={activeTab === 'files'}
          />
        )}
      </div>
    </div>
  );
}

export default React.memo(MainContent);
