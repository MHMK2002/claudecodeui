import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownIcon, Bot, GitFork } from 'lucide-react';

import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import PermissionContext from '../../../contexts/PermissionContext';
import type { ChatInterfaceProps, PermissionMode, Provider  } from '../types/types';
import { api } from '../../../utils/api';
import {
  resolveValidSelection,
  useProviderSelectionCatalog,
} from '../../../shared/hooks/useProviderSelectionCatalog';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import type { SessionRewindMode } from '../hooks/useChatSessionState';
import { materializeChatImages } from '../utils/materializeChatImages';
import { mergeCopiedMessageIntoDraft } from '../utils/copyToComposer';
import { startTaskImplementation } from '../../task-master/workflow';
import { getProviderCatalogSendBlockReason } from '../../../shared/providerSelectionCatalog';
import {
  canRetryTaskStartForProject,
  isTaskStartAttemptCurrent,
  resolveChatPrimaryAction,
} from '../utils/chatRunControls';
import type { TaskMasterTask } from '../../task-master/types';
import { useTaskMaster } from '../../task-master/context/TaskMasterContext';

import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import CommandResultModal from './subcomponents/CommandResultModal';
import RewindConfirmModal from './subcomponents/RewindConfirmModal';

function ChatInterface({
  sessionStore,
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  showRawParameters,
  showThinking,
  sendByCtrlEnter,
  externalMessageUpdate,
  newSessionTrigger,
  onShowAllTasks,
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { refreshTasks } = useTaskMaster();
  const { subscribe, isConnected: isSocketConnected, reconnect } = useWebSocket();
  const { t } = useTranslation('chat');
  // Sub-agent sessions carry the id of the session that spawned them; they are
  // finished transcripts, so the composer is replaced by a read-only banner.
  const isAgentTranscript = Boolean(selectedSession?.parentSessionId);

  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);
  const [taskStartFailure, setTaskStartFailure] = useState<{
    task: TaskMasterTask;
    projectId: string;
    message: string;
  } | null>(null);
  const [providerSwitching, setProviderSwitching] = useState(false);
  const [providerSwitchError, setProviderSwitchError] = useState<string | null>(null);
  const providerSwitchInFlightRef = useRef(false);
  const taskStartAttemptRef = useRef(0);
  const currentTaskViewRef = useRef({
    projectId: selectedProject?.projectId ?? null,
    sessionId: selectedSession?.id ?? null,
  });
  currentTaskViewRef.current = {
    projectId: selectedProject?.projectId ?? null,
    sessionId: selectedSession?.id ?? null,
  };
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  // When each session's `chat.subscribe` was last sent; idle acks older than
  // a later local request are discarded as stale.
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  // Highest live `seq` observed per session. Written by the realtime handler
  // on every sequenced frame, read whenever a `chat.subscribe` is sent so the
  // server replays only the events this client actually missed.
  const lastSeqRef = useRef(new Map<string, number>());

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    accumulatedStreamRef.current = '';
  }, []);

  const {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    currentProviderEffort,
    currentProviderEffortOptions,
    currentProviderModel,
    opencodeModel,
    setOpenCodeModel,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    availablePermissionModes,
    selectPermissionMode,
    cyclePermissionMode,
    providerModelCatalog,
    providerModelCacheCatalog,
    providerModelsLoading,
    providerModelsRefreshing,
    selectedClaudeProfileId,
    setSelectedClaudeProfileId,
    selectedCodexProfileId,
    setSelectedCodexProfileId,
    hardRefreshProviderModels,
    selectProviderModel,
    setStoredProviderModel,
    setStoredProviderEffort,
    resolvePermissionModeForProvider,
  } = useChatProviderState({
    selectedSession,
    selectedProject,
  });
  const providerCatalogState = useProviderSelectionCatalog();
  const { catalog: providerSelectionCatalog } = providerCatalogState;
  const currentProviderModelOptions = useMemo(
    () => providerSelectionCatalog?.providers.find((entry) => entry.provider === provider)?.models.OPTIONS ?? [],
    [provider, providerSelectionCatalog],
  );

  const {
    chatMessages,
    addMessage,
    requestRewind,
    rewindTarget,
    confirmRewind,
    cancelRewind,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    showDelayedSessionSkeleton,
    sessionHistoryError,
    retrySessionHistory,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    externalMessageUpdate,
    newSessionTrigger,
    processingSessions,
    onSessionIdle,
    resetStreamingState,
    statusCheckSentAtRef,
    lastSeqRef,
    sessionStore,
  });

  // A brand-new chat never trusts a stale localStorage-only target. Once the
  // Settings-backed catalog arrives, reconcile the pending triple to a valid
  // profile/model (or the first available provider) before session creation.
  useEffect(() => {
    if (!providerSelectionCatalog || selectedSession?.id || currentSessionId) return;
    const currentProfileId = provider === 'claude'
      ? selectedClaudeProfileId
      : provider === 'codex'
        ? selectedCodexProfileId
        : null;
    const preferredModel = provider === 'claude'
      ? claudeModel
      : provider === 'cursor'
        ? cursorModel
        : provider === 'codex'
          ? codexModel
          : opencodeModel;
    const resolved = resolveValidSelection(providerSelectionCatalog, provider, {
      profileId: currentProfileId,
      model: preferredModel,
    }) ?? providerSelectionCatalog.providers
      .filter((entry) => entry.available)
      .map((entry) => resolveValidSelection(providerSelectionCatalog, entry.provider))
      .find((candidate) => candidate !== null) ?? null;
    if (!resolved) return;

    if (resolved.provider !== provider) {
      setProvider(resolved.provider);
      localStorage.setItem('selected-provider', resolved.provider);
    }
    if (resolved.provider === 'claude' && resolved.providerProfileId !== selectedClaudeProfileId) {
      setSelectedClaudeProfileId(resolved.providerProfileId);
    }
    if (resolved.provider === 'codex' && resolved.providerProfileId !== selectedCodexProfileId) {
      setSelectedCodexProfileId(resolved.providerProfileId);
    }
    if (resolved.model !== preferredModel || resolved.provider !== provider) {
      setStoredProviderModel(resolved.provider, resolved.model);
    }
  }, [
    claudeModel,
    codexModel,
    currentSessionId,
    cursorModel,
    opencodeModel,
    provider,
    providerSelectionCatalog,
    selectedClaudeProfileId,
    selectedCodexProfileId,
    selectedSession?.id,
    setProvider,
    setSelectedClaudeProfileId,
    setSelectedCodexProfileId,
    setStoredProviderModel,
  ]);

  // Brand-new conversation: the composer allocated a stable session id via
  // the session gateway before the first send. Record it locally and put it
  // in the URL — this id never changes again, so there is no later handoff.
  const handleSessionEstablished = useCallback<NonNullable<ChatInterfaceProps['onSessionEstablished']>>((sessionId, context) => {
    setCurrentSessionId(sessionId);
    onSessionEstablished?.(sessionId, context);
    onNavigateToSession?.(sessionId);
  }, [setCurrentSessionId, onSessionEstablished, onNavigateToSession]);

  const handleStartTask = useCallback(async (task: TaskMasterTask) => {
    if (!selectedProject || startingTaskId) return;
    const attemptId = ++taskStartAttemptRef.current;
    const originView = {
      projectId: selectedProject.projectId,
      sessionId: selectedSession?.id ?? null,
    };
    const attemptIsCurrent = () => isTaskStartAttemptCurrent(
      attemptId,
      taskStartAttemptRef.current,
      originView,
      currentTaskViewRef.current,
    );
    setStartingTaskId(String(task.id));
    setTaskStartFailure(null);
    try {
      await startTaskImplementation({
        project: selectedProject,
        task,
        selection: {
          provider,
          providerProfileId: provider === 'claude'
            ? selectedClaudeProfileId
            : provider === 'codex'
              ? selectedCodexProfileId
              : null,
          model: currentProviderModel,
        },
        sendMessage,
        onSessionEstablished: (sessionId, context) => {
          if (attemptIsCurrent()) handleSessionEstablished(sessionId, context);
        },
        onSessionProcessing,
      });
      if (!attemptIsCurrent()) return;
      await refreshTasks();
      if (!attemptIsCurrent()) return;
    } catch (error) {
      if (!attemptIsCurrent()) return;
      setTaskStartFailure({
        task,
        projectId: originView.projectId,
        message: error instanceof Error ? error.message : 'Failed to start implementation.',
      });
    } finally {
      if (taskStartAttemptRef.current === attemptId) {
        setStartingTaskId(null);
      }
    }
  }, [
    currentProviderModel,
    handleSessionEstablished,
    onSessionProcessing,
    provider,
    refreshTasks,
    selectedClaudeProfileId,
    selectedCodexProfileId,
    selectedProject,
    selectedSession?.id,
    sendMessage,
    startingTaskId,
  ]);

  useEffect(() => {
    taskStartAttemptRef.current += 1;
    setStartingTaskId(null);
    setTaskStartFailure(null);
  }, [selectedProject?.projectId, selectedSession?.id]);

  const {
    input,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    setAttachedFiles,
    uploadingFiles,
    fileErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openAttachmentPicker,
    handleSubmit,
    queuedDraft,
    editQueuedDraft,
    deleteQueuedDraft,
    handleVoiceTranscript,
    handleVoiceInterim,
    captureVoiceOrigin,
    voiceViewKey,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    setInputText,
    restoreDraft,
    handleAbortSession,
    transportFailure,
    clearTransportFailure,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    commandModalPayload,
    closeCommandModal,
    showCostModal,
  } = useChatComposerState({
    chatMessages,
    selectedProject,
    selectedSession,
    currentSessionId,
    newSessionTrigger,
    provider,
    permissionMode,
    cyclePermissionMode,
    currentProviderModel,
    currentProviderEffort,
    selectedClaudeProfileId,
    selectedCodexProfileId,
    isLoading: isProcessing,
    isSocketConnected,
    sendBlockedReason: getProviderCatalogSendBlockReason(providerCatalogState.error, isProcessing)
      ?? (!isSocketConnected && !isProcessing
        ? 'Chat is reconnecting. Your draft is preserved until the connection returns.'
        : null),
    processingSessions,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionProcessing,
    onSessionEstablished: handleSessionEstablished,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    scrollToBottom,
    addMessage,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
    resolvePermissionModeForProvider,
  });

  const chatPrimaryAction = resolveChatPrimaryAction({
    isRunning: isProcessing,
    hasCatalogError: Boolean(providerCatalogState.error),
    hasHistoryError: Boolean(sessionHistoryError),
    connectionUnavailable: !isSocketConnected || Boolean(transportFailure),
  });

  const handleConfirmRewind = useCallback(async (mode: SessionRewindMode) => {
    const draft = await confirmRewind(mode);
    if (!draft) return;
    const files = await materializeChatImages(draft.images, selectedProject?.projectId);
    restoreDraft(draft.content, files);
  }, [confirmRewind, restoreDraft, selectedProject?.projectId]);

  const copyMessageToComposer = useCallback((
    _messageId: string,
    content: string,
    images: import('../types/types').ChatImage[],
  ) => {
    void materializeChatImages(images, selectedProject?.projectId)
      .then((copiedFiles) => {
        restoreDraft(
          mergeCopiedMessageIntoDraft(input, content),
          [...attachedFiles, ...copiedFiles],
        );
      })
      .catch((error: unknown) => {
        addMessage({
          type: 'error',
          content: `Copy failed: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        });
      });
  }, [addMessage, attachedFiles, input, restoreDraft, selectedProject?.projectId]);

  // On WebSocket reconnect, re-fetch the current session's messages from the
  // server so missed streaming events are shown, then re-subscribe — the
  // `chat_subscribed` ack restores or clears the activity indicator, replays
  // missed live events, and re-attaches a still-running stream to this socket.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    await sessionStore.refreshFromServer(selectedSession.id);
    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());
    sendMessage({
      type: 'chat.subscribe',
      sessions: [{
        sessionId: selectedSession.id,
        lastSeq: lastSeqRef.current.get(selectedSession.id) ?? 0,
      }],
    });
  }, [selectedProject, selectedSession, sendMessage, sessionStore]);

  useChatRealtimeHandlers({
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    setTokenBudget,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
    lastSeqRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onWebSocketReconnect: handleWebSocketReconnect,
    sessionStore,
  });

  useEffect(() => {
    if (!canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision,
  }), [pendingPermissionRequests, handlePermissionDecision]);

  // A composer pick becomes the default for new chats and, when a session is
  // open, is recorded against that session so reopening it restores this model.
  const handleSelectComposerModel = useCallback(async (model: string) => {
    try {
      await selectProviderModel(provider, model, currentSessionId || selectedSession?.id || null);
    } catch (error) {
      console.error('Error changing the active session model:', error);
    }
  }, [currentSessionId, provider, selectProviderModel, selectedSession?.id]);

  // Provider/profile selection from the composer's provider menu.
  //
  // New chat (no session yet): the pick changes the pending selection — the
  // model resets to the target provider's valid default and the composer
  // reflects the change immediately; the first message then creates the
  // session with exactly this provider/profile/model.
  //
  // Existing chat: an identical pick is a no-op. Changing provider or profile
  // forks the session with carryContext: true so the new conversation keeps a
  // handoff summary of the current one. Until the fork succeeds, the current
  // session's state is untouched; on error the user stays in the current
  // session with a visible message, and navigation happens only after the
  // backend confirms.
  const handleSelectComposerProvider = useCallback(
    async (nextProvider: Provider, nextProfileId: number | null) => {
      if (providerSwitchInFlightRef.current) return;
      const openSessionId = selectedSession?.id ?? currentSessionId ?? null;
      const preferredModel = nextProvider === 'claude'
        ? claudeModel
        : nextProvider === 'cursor'
          ? cursorModel
          : nextProvider === 'codex'
            ? codexModel
            : opencodeModel;
      const targetSelection = resolveValidSelection(providerSelectionCatalog, nextProvider, {
        profileId: nextProfileId,
        model: preferredModel,
      });
      if (!targetSelection || targetSelection.providerProfileId !== nextProfileId) {
        setProviderSwitchError('This provider selection is no longer available. Update it in Settings and try again.');
        return;
      }

      if (!openSessionId) {
        // Pending selection for the not-yet-created session.
        setProvider(nextProvider);
        localStorage.setItem('selected-provider', nextProvider);
        if (nextProvider === 'claude') {
          setSelectedClaudeProfileId(nextProfileId);
        } else if (nextProvider === 'codex') {
          setSelectedCodexProfileId(nextProfileId);
        }
        // Drop the previous provider's model so the new chat uses the target
        // provider's valid default (reconciled by useChatProviderState once
        // the catalog resolves it).
        setStoredProviderModel(nextProvider, targetSelection.model);
        return;
      }

      const isSamePick = provider === nextProvider
        && (nextProvider === 'claude'
          ? selectedClaudeProfileId
          : nextProvider === 'codex'
            ? selectedCodexProfileId
            : null) === nextProfileId;
      if (isSamePick || !onNavigateToSession) {
        return;
      }

      setProviderSwitchError(null);
      providerSwitchInFlightRef.current = true;
      setProviderSwitching(true);
      try {
        const response = await api.forkSession(openSessionId, {
          provider: targetSelection.provider,
          providerProfileId: targetSelection.providerProfileId,
          model: targetSelection.model,
          carryContext: true,
        });
        const payload = await response.json();
        const newSessionId = payload?.data?.sessionId;
        if (!response.ok || !newSessionId) {
          throw new Error(payload?.message || payload?.error || 'The provider switch fork failed.');
        }
        onNavigateToSession(newSessionId);
      } catch (switchError) {
        setProviderSwitchError(
          switchError instanceof Error
            ? switchError.message
            : 'Failed to switch provider. You are still in the current session.',
        );
      } finally {
        providerSwitchInFlightRef.current = false;
        setProviderSwitching(false);
      }
    },
    [
      claudeModel,
      codexModel,
      currentSessionId,
      cursorModel,
      onNavigateToSession,
      opencodeModel,
      provider,
      providerSelectionCatalog,
      selectedClaudeProfileId,
      selectedCodexProfileId,
      selectedSession?.id,
      setProvider,
      setSelectedClaudeProfileId,
      setSelectedCodexProfileId,
      setStoredProviderModel,
    ],
  );

  // Mirrors ChatComposer's own visibility check so the message pane can
  // reserve enough bottom space to keep the floating status tab from
  // overlapping the last message.
  const hasActivityIndicator = Boolean(sessionActivity && pendingPermissionRequests.length === 0);

  const selectedProviderLabel =
    provider === 'cursor'
      ? t('messageTypes.cursor')
      : provider === 'codex'
        ? t('messageTypes.codex')
        : provider === 'opencode'
            ? t('messageTypes.opencode', { defaultValue: 'OpenCode' })
          : t('messageTypes.claude');

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  const forkContextBannerSessionId = currentSessionId || selectedSession?.id || null;
  const showForkContextBanner = Boolean(
    forkContextBannerSessionId && sessionStore.getSessionSlot(forkContextBannerSessionId)?.pendingForkContext,
  );

  return (
    <PermissionContext.Provider value={permissionContextValue}>
      <div className="flex h-full min-h-0 flex-col">
        {showForkContextBanner && (
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <GitFork className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            <span>
              {t('providerSelection.forkContextBanner', {
                defaultValue: 'A summary of the previous chat will be included in your first message.',
              })}
            </span>
          </div>
        )}
        {taskStartFailure && (
          <div
            role="alert"
            className="flex flex-shrink-0 flex-col gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="min-w-0 text-foreground">{taskStartFailure.message}</span>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!canRetryTaskStartForProject(taskStartFailure.projectId, selectedProject?.projectId)) {
                    setTaskStartFailure(null);
                    return;
                  }
                  void handleStartTask(taskStartFailure.task);
                }}
                disabled={startingTaskId !== null}
                className="min-h-11 rounded-md border border-border bg-background px-3 py-2 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {startingTaskId !== null ? 'Retrying…' : 'Retry'}
              </button>
              <button
                type="button"
                onClick={() => setTaskStartFailure(null)}
                className="min-h-11 rounded-md px-3 py-2 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          isLoadingSessionMessages={isLoadingSessionMessages}
          showDelayedSessionSkeleton={showDelayedSessionSkeleton}
          sessionHistoryError={sessionHistoryError}
          historyRecoveryPrimary={chatPrimaryAction === 'retry-history'}
          onRetrySessionHistory={() => {
            void retrySessionHistory();
          }}
          isProcessing={isProcessing}
          hasActivityIndicator={hasActivityIndicator}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={setProvider}
          textareaRef={textareaRef}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          cursorModel={cursorModel}
          setCursorModel={setCursorModel}
          codexModel={codexModel}
          setCodexModel={setCodexModel}
          opencodeModel={opencodeModel}
          setOpenCodeModel={setOpenCodeModel}
          selectedClaudeProfileId={selectedClaudeProfileId}
          setSelectedClaudeProfileId={setSelectedClaudeProfileId}
          selectedCodexProfileId={selectedCodexProfileId}
          setSelectedCodexProfileId={setSelectedCodexProfileId}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          onStartTask={(task) => {
            void handleStartTask(task);
          }}
          isStartingTask={startingTaskId !== null}
          providerSelectionCatalog={providerSelectionCatalog}
          providerCatalogLoading={providerCatalogState.loading}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          sessionMessagesCount={chatMessages.length}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
          isLoadingAllMessages={isLoadingAllMessages}
          loadAllJustFinished={loadAllJustFinished}
          showLoadAllOverlay={showLoadAllOverlay}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          onRequestRewind={!isProcessing && !rewindTarget ? requestRewind : undefined}
          onCopyToComposer={copyMessageToComposer}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
        />

        <div className="relative flex-shrink-0">
          {isUserScrolledUp && chatMessages.length > 0 && (
            <div className="pointer-events-none absolute -top-11 left-0 right-0 z-20 flex justify-center">
              <button
                type="button"
                onClick={scrollToBottomAndReset}
                aria-label={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
                className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-foreground"
                title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
              >
                <ArrowDownIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}

          {/* An agent transcript is a record of a run that already happened
              under another session — there is nothing to send it to. */}
          {isAgentTranscript ? (
          <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              {t('agentTranscript.readOnly', {
                defaultValue: 'Read-only transcript of the {{agentType}} agent.',
                agentType: selectedSession?.agentType || t('agentTranscript.defaultType', { defaultValue: 'sub' }),
              })}
            </span>
            <button
              type="button"
              className="flex-shrink-0 rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:bg-accent"
              onClick={() => onNavigateToSession?.(selectedSession!.parentSessionId!)}
            >
              {t('agentTranscript.backToParent', { defaultValue: 'Back to parent session' })}
            </button>
          </div>
          ) : (
          <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          activity={sessionActivity}
          isLoading={isProcessing}
          primaryAction={chatPrimaryAction}
          isSocketConnected={isSocketConnected}
          sendBlockedReason={getProviderCatalogSendBlockReason(providerCatalogState.error, isProcessing)
            ?? (!isSocketConnected && !isProcessing
              ? 'Chat is reconnecting. Your draft is preserved until the connection returns.'
              : null)}
          transportFailure={transportFailure}
          onRetryConnection={reconnect}
          onDismissTransportFailure={clearTransportFailure}
          onAbortSession={handleAbortSession}
          permissionMode={permissionMode}
          availablePermissionModes={availablePermissionModes}
          onSelectPermissionMode={(mode) => selectPermissionMode(mode as PermissionMode)}
          providerLabel={selectedProviderLabel}
          currentProvider={provider}
          currentProviderProfileId={
            provider === 'claude'
              ? selectedClaudeProfileId
              : provider === 'codex'
                ? selectedCodexProfileId
                : null
          }
          onSelectProvider={handleSelectComposerProvider}
          providerSwitching={providerSwitching}
          providerSwitchError={providerSwitchError}
          onDismissProviderSwitchError={() => setProviderSwitchError(null)}
          effort={currentProviderEffort}
          availableEffortOptions={currentProviderEffortOptions}
          onSelectEffort={(nextEffort) => setStoredProviderEffort(provider, nextEffort)}
          model={currentProviderModel}
          availableModelOptions={currentProviderModelOptions}
          onSelectModel={handleSelectComposerModel}
          modelsLoading={providerModelsLoading}
          providerSelectionCatalog={providerSelectionCatalog}
          providerCatalogLoading={providerCatalogState.loading}
          providerCatalogError={providerCatalogState.error}
          onRetryProviderCatalog={providerCatalogState.reload}
          onOpenAgentSettings={() => onShowSettings?.('agents')}
          tokenBudget={tokenBudget}
          onShowTokenUsage={showCostModal}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={handleToggleCommandMenu}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          queuedDraft={queuedDraft}
          onEditQueuedDraft={editQueuedDraft}
          onDeleteQueuedDraft={deleteQueuedDraft}
          attachedFiles={attachedFiles}
          onRemoveAttachment={(index) =>
            setAttachedFiles((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingFiles={uploadingFiles}
          fileErrors={fileErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openAttachmentPicker={openAttachmentPicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onVoiceTranscript={handleVoiceTranscript}
          onVoiceInterim={handleVoiceInterim}
          onVoiceCommit={captureVoiceOrigin}
          onApplyEnhancedText={setInputText}
          viewedSessionKey={voiceViewKey}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          isInputFocused={isInputFocused}
          onInputFocusChange={handleInputFocusChange}
          placeholder={t('input.placeholder', { provider: selectedProviderLabel })}
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
        />
          )}
        </div>
      </div>

      <CommandResultModal
        payload={commandModalPayload}
        onClose={closeCommandModal}
        providerModelCatalog={providerModelCatalog}
        providerModelCacheCatalog={providerModelCacheCatalog}
        providerModelsRefreshing={providerModelsRefreshing}
        onHardRefreshProviderModels={hardRefreshProviderModels}
        currentSessionId={currentSessionId || selectedSession?.id || null}
        onSelectProviderModel={selectProviderModel}
      />

      <RewindConfirmModal
        target={rewindTarget}
        onConfirm={handleConfirmRewind}
        onCancel={cancelRewind}
      />
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);
