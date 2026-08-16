import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';

import { authenticatedFetch } from '../../../utils/api';
import type { MarkSessionProcessing, SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { VoiceTranscriptDelivery } from '../../../lib/finalizeVoiceTranscript';
import { grantClaudeToolPermission } from '../utils/chatPermissions';
import { buildVoiceViewKey, isBackgroundVoiceOrigin } from '../utils/voiceOrigin';
import {
  clearQueuedMessage,
  readQueuedMessage,
  safeLocalStorage,
  writeQueuedMessage,
  type QueuedSendOptions,
} from '../utils/chatStorage';
import type {
  ChatAttachment,
  ChatMessage,
  PendingPermissionRequest,
  PermissionMode,
  SessionEstablishedContext,
} from '../types/types';
import type { Project, ProjectSession, LLMProvider, ProviderModelsCacheInfo } from '../../../types/app';
import { escapeRegExp } from '../utils/chatFormatting';
import { isChatSubmissionBlocked } from '../../../shared/providerSelectionCatalog';
import type { SendWebSocketMessage } from '../../../contexts/webSocketDispatch';

import { useFileMentions } from './useFileMentions';
import { type SlashCommand, useSlashCommands } from './useSlashCommands';

interface UseChatComposerStateArgs {
  /**
   * The conversation on screen. Read only to build the ArrowUp/ArrowDown
   * recall list (the user's own past turns), never rendered from here.
   */
  chatMessages: ChatMessage[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  newSessionTrigger?: number;
  provider: LLMProvider;
  permissionMode: PermissionMode | string;
  cyclePermissionMode: () => void;
  resolvePermissionModeForProvider: (provider: LLMProvider, requestedMode: PermissionMode | string) => PermissionMode;
  /**
   * Model every send and command carries: the open session's model when there
   * is one, otherwise the user's per-provider selection.
   */
  currentProviderModel: string;
  currentProviderEffort: string;
  selectedClaudeProfileId: number | null;
  selectedCodexProfileId: number | null;
  isLoading: boolean;
  /** Current socket state, used to keep drafts intact while reconnecting. */
  isSocketConnected: boolean;
  /** Non-null while every idle send path (button, Enter, voice) must preserve the draft. */
  sendBlockedReason?: string | null;
  processingSessions?: SessionActivityMap;
  canAbortSession: boolean;
  tokenBudget: Record<string, unknown> | null;
  sendMessage: SendWebSocketMessage;
  sendByCtrlEnter?: boolean;
  onSessionProcessing?: MarkSessionProcessing;
  /**
   * Invoked with the freshly allocated session id when the user sends the
   * first message of a brand-new conversation. The backend allocates the id
   * via POST /api/providers/sessions BEFORE the websocket send, so the id is
   * stable for the conversation's whole lifetime — the consumer navigates to
   * /session/:id and records it as the current session.
   */
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  scrollToBottom: () => void;
  addMessage: (msg: ChatMessage) => void;
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: 'builtin' | 'custom';
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
}

export type ModelCommandData = {
  current?: {
    provider?: string;
    providerLabel?: string;
    model?: string;
  };
  available?: Partial<Record<LLMProvider, string[]>>;
  availableModels?: string[];
  availableOptions?: Array<{
    value: string;
    label?: string;
    description?: string;
  }>;
  defaultModel?: string;
  cache?: ProviderModelsCacheInfo;
};

export type CostCommandData = {
  tokenUsage?: {
    used?: number;
    total?: number;
  };
  tokenBreakdown?: {
    input?: number;
    output?: number;
  };
  provider?: string;
  model?: string;
};

export type StatusCommandData = {
  version?: string;
  packageName?: string;
  uptime?: string;
  model?: string;
  provider?: string;
  nodeVersion?: string;
  platform?: string;
  pid?: number;
  memoryUsage?: {
    rssMb?: number;
    heapUsedMb?: number;
    heapTotalMb?: number;
  };
};

export type HelpCommandData = {
  content?: string;
  format?: string;
  commands?: Array<{
    name: string;
    description?: string;
    namespace?: string;
  }>;
};

export type CommandModalKind = 'help' | 'models' | 'cost' | 'status';

export type CommandModalPayload = {
  kind: CommandModalKind;
  data: HelpCommandData | ModelCommandData | CostCommandData | StatusCommandData;
};

const createFakeSubmitEvent = () => {
  return { preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>;
};

const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const isImageAttachment = (attachment: ChatAttachment) => {
  if (attachment.mimeType?.startsWith('image/')) return true;
  return /\.(gif|jpe?g|png|svg|webp)$/i.test(attachment.path || attachment.name || '');
};

const uploadAttachmentFiles = async (files: File[]): Promise<unknown[]> => {
  if (files.length === 0) {
    return [];
  }

  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const response = await authenticatedFetch('/api/assets/files', {
    method: 'POST',
    headers: {},
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'Failed to upload files');
  }

  const result = await response.json();
  if (!Array.isArray(result.attachments) || result.attachments.length !== files.length) {
    throw new Error('File upload returned an incomplete result');
  }
  return result.attachments;
};

export type QueuedDraft = {
  content: string;
  /** Browser files retained while this composer stays mounted, for editing. */
  attachments: File[];
  /** JSON-safe descriptors uploaded when the message is queued. */
  uploadedAttachments?: unknown[];
  /**
   * Send options snapshotted at queue time. Persisted with the draft so the
   * app-level auto-send can dispatch the message with the right model and
   * permission settings while another session is being viewed.
   */
  options?: QueuedSendOptions;
};

/**
 * Which session a voice recording is committed to, snapshotted at stop/send time.
 * `key` is the target session id (null for a brand-new, not-yet-created session);
 * `options` are that session's send settings captured before any session switch, so
 * a transcript that resolves after the user moves away still dispatches correctly.
 */
export type VoiceOrigin = {
  key: string | null;
  /** Stable identity even before a backend session id exists. */
  viewKey: string;
  options: QueuedSendOptions;
  /**
   * Project + provider identity of the origin session, snapshotted at commit time.
   * Lets a transcript dictated in a brand-new (not-yet-created) chat allocate that
   * chat's session and be delivered there even after the user has switched away.
   */
  projectPath: string;
  provider: LLMProvider;
  providerProfileId: number | null;
};

const restoreQueuedDraft = (sessionKey: string): QueuedDraft | null => {
  const saved = readQueuedMessage(sessionKey);
  return saved
    ? {
        content: saved.content,
        attachments: [],
        uploadedAttachments: saved.attachments ?? saved.images,
        options: saved.options,
      }
    : null;
};

const getNotificationSessionSummary = (
  selectedSession: ProjectSession | null,
  fallbackInput: string,
): string | null => {
  const sessionSummary = selectedSession?.summary || selectedSession?.name || selectedSession?.title;
  if (typeof sessionSummary === 'string' && sessionSummary.trim()) {
    const normalized = sessionSummary.replace(/\s+/g, ' ').trim();
    return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
  }

  const normalizedFallback = fallbackInput.replace(/\s+/g, ' ').trim();
  if (!normalizedFallback) {
    return null;
  }

  return normalizedFallback.length > 80 ? `${normalizedFallback.slice(0, 77)}...` : normalizedFallback;
};

export function useChatComposerState({
  chatMessages,
  selectedProject,
  selectedSession,
  currentSessionId,
  newSessionTrigger,
  provider,
  permissionMode,
  cyclePermissionMode,
  resolvePermissionModeForProvider,
  currentProviderModel,
  currentProviderEffort,
  selectedClaudeProfileId,
  selectedCodexProfileId,
  isLoading,
  isSocketConnected,
  sendBlockedReason = null,
  processingSessions,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionProcessing,
  onSessionEstablished,
  onInputFocusChange,
  onFileOpen,
  onShowSettings,
  scrollToBottom,
  addMessage,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
}: UseChatComposerStateArgs) {
  const [transportFailure, setTransportFailure] = useState<{
    action: 'send' | 'stop' | 'permission';
    message: string;
    sessionId: string | null;
    projectId: string | null;
  } | null>(null);
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      // Draft inputs are keyed by the DB projectId so per-project drafts
      // survive display-name changes.
      return safeLocalStorage.getItem(`draft_input_${selectedProject.projectId}`) || '';
    }
    return '';
  });
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, number>>(new Map());
  const [fileErrors, setFileErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [commandModalPayload, setCommandModalPayload] = useState<CommandModalPayload | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const textareaLineHeightRef = useRef<number | null>(null);
  const lastAutosizedInputRef = useRef<string | null>(null);
  const handleSubmitRef = useRef<
    ((
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
      queuedSubmission?: QueuedDraft,
    ) => Promise<void>) | null
  >(null);
  const inputValueRef = useRef(input);
  const selectedProjectId = selectedProject?.projectId;
  // Prefer the stable backend-allocated id (selectedSession.id) but fall back
  // to currentSessionId for a just-established session that hasn't been
  // handed back to the parent's `selectedSession` prop yet.
  const sessionKey = selectedSession?.id || currentSessionId || null;
  const voiceViewKey = buildVoiceViewKey(
    sessionKey,
    provider,
    selectedProjectId || selectedProject?.fullPath || selectedProject?.path,
    newSessionTrigger,
  );
  // Live mirror of the full viewed origin. A nullable session id alone collapses
  // distinct unsaved projects/chats to the same identity.
  const voiceViewKeyRef = useRef(voiceViewKey);
  voiceViewKeyRef.current = voiceViewKey;

  const sessionKeyRef = useRef(sessionKey);
  const processingSessionsRef = useRef<SessionActivityMap | undefined>(processingSessions);
  const sendBlockedReasonRef = useRef<string | null>(sendBlockedReason);
  sessionKeyRef.current = sessionKey;
  processingSessionsRef.current = processingSessions;
  sendBlockedReasonRef.current = sendBlockedReason;

  const previousSocketConnectedRef = useRef(isSocketConnected);
  useEffect(() => {
    const wasConnected = previousSocketConnectedRef.current;
    previousSocketConnectedRef.current = isSocketConnected;
    if (!wasConnected && isSocketConnected) {
      setTransportFailure(null);
    }
  }, [isSocketConnected]);

  useEffect(() => {
    setTransportFailure((current) => (
      current
      && current.sessionId === sessionKey
      && current.projectId === (selectedProjectId ?? null)
        ? current
        : null
    ));
  }, [selectedProjectId, sessionKey]);

  const [queuedDraft, setQueuedDraft] = useState<QueuedDraft | null>(() => {
    if (typeof window === 'undefined' || !sessionKey) {
      return null;
    }
    return restoreQueuedDraft(sessionKey);
  });
  // Which session the in-memory `queuedDraft` belongs to. On a session switch
  // there is one commit where `sessionKey` already points at the new session
  // while `queuedDraft` still holds the old session's draft; the persistence
  // effect must not write across that gap.
  const queuedDraftSessionRef = useRef<string | null>(sessionKey);

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'help':
          setCommandModalPayload({
            kind: 'help',
            data: (data || {}) as HelpCommandData,
          });
          break;

        case 'models':
          setCommandModalPayload({
            kind: 'models',
            data: (data || {}) as ModelCommandData,
          });
          break;

        case 'cost': {
          setCommandModalPayload({
            kind: 'cost',
            data: (data || {}) as CostCommandData,
          });
          break;
        }

        case 'status': {
          setCommandModalPayload({
            kind: 'status',
            data: (data || {}) as StatusCommandData,
          });
          break;
        }

        case 'memory':
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `Warning: ${data.message}`,
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              type: 'assistant',
              content: `${data.message}\n\nPath: \`${data.path}\``,
              timestamp: Date.now(),
            });
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case 'config':
          onShowSettings?.();
          break;

        default:
          console.warn('Unknown built-in command action:', action);
      }
    },
    [onFileOpen, onShowSettings, addMessage],
  );

  const closeCommandModal = useCallback(() => {
    setCommandModalPayload(null);
  }, []);

  const handleCustomCommand = useCallback(async (result: CommandExecutionResult) => {
    const { content, hasBashCommands } = result;

    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?',
      );
      if (!confirmed) {
        addMessage({
          type: 'assistant',
          content: 'Command execution cancelled',
          timestamp: Date.now(),
        });
        return;
      }
    }

    const commandContent = content || '';
    setInput(commandContent);
    inputValueRef.current = commandContent;

    // Defer submit to next tick so the command text is reflected in UI before dispatching.
    setTimeout(() => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
      }
    }, 0);
  }, [addMessage]);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string, options?: { preserveInput?: boolean }) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const commandMatch = effectiveInput.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
        const args =
          commandMatch && commandMatch[1] ? commandMatch[1].trim().split(/\s+/) : [];

        // The `/api/commands/execute` context sends `projectId` now instead of
        // a folder-derived project name; the path is still included verbatim.
        const context = {
          projectPath: selectedProject.fullPath || selectedProject.path,
          projectId: selectedProject.projectId,
          sessionId: currentSessionId || selectedSession?.id || null,
          provider,
          model: currentProviderModel,
          tokenUsage: tokenBudget,
        };

        const response = await authenticatedFetch('/api/commands/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin') {
          handleBuiltInCommand(result);
          if (!options?.preserveInput) {
            setInput('');
            inputValueRef.current = '';
          }
        } else if (result.type === 'custom') {
          await handleCustomCommand(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        addMessage({
          type: 'assistant',
          content: `Error executing command: ${message}`,
          timestamp: Date.now(),
        });
      }
    },
    [
      currentProviderModel,
      currentSessionId,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      provider,
      selectedProject,
      selectedSession?.id,
      addMessage,
      tokenBudget,
    ],
  );

  const showCostModal = useCallback(() => {
    executeCommand(
      {
        name: '/cost',
        description: 'Display token usage information',
        namespace: 'builtin',
        metadata: { type: 'builtin' },
      } as SlashCommand,
      '/cost',
      { preserveInput: true },
    );
  }, [executeCommand]);

  const {
    slashCommands,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  } = useSlashCommands({
    selectedProject,
    provider,
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
  });

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const resizeTextarea = useCallback((target: HTMLTextAreaElement) => {
    target.style.height = 'auto';
    const nextHeight = Math.max(22, target.scrollHeight);
    target.style.height = `${nextHeight}px`;

    let lineHeight = textareaLineHeightRef.current;
    if (!lineHeight) {
      lineHeight = parseInt(window.getComputedStyle(target).lineHeight);
      textareaLineHeightRef.current = Number.isFinite(lineHeight) ? lineHeight : 24;
    }

    const expanded = nextHeight > (textareaLineHeightRef.current || 24) * 2;
    setIsTextareaExpanded((previous) => previous === expanded ? previous : expanded);
    lastAutosizedInputRef.current = target.value;
  }, []);

  const handleAttachmentFiles = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (file.size > MAX_ATTACHMENT_SIZE) {
          const fileName = file.name || 'Unknown file';
          setFileErrors((previous) => {
            const next = new Map(previous);
            next.set(fileName, 'File too large (max 10MB)');
            return next;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedFiles((previous) => [...previous, ...validFiles].slice(0, MAX_ATTACHMENT_COUNT));
    }
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (!item.type.startsWith('image/')) {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleAttachmentFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        const imageFiles = files.filter((file) => file.type.startsWith('image/'));
        if (imageFiles.length > 0) {
          handleAttachmentFiles(imageFiles);
        }
      }
    },
    [handleAttachmentFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    maxSize: MAX_ATTACHMENT_SIZE,
    maxFiles: MAX_ATTACHMENT_COUNT,
    onDrop: handleAttachmentFiles,
    noClick: true,
    noKeyboard: true,
  });

  // Snapshot of everything `chat.send` needs beyond the text itself. Built at
  // send time for immediate sends and at queue time for queued ones, so a
  // queued message keeps the provider settings it was composed under even if
  // it is later dispatched outside this composer (app-level auto-send).
  const buildSendOptions = useCallback((currentInput: string): QueuedSendOptions => {
    const getToolsSettings = () => {
      try {
        const settingsKey =
          provider === 'cursor'
            ? 'cursor-tools-settings'
            : provider === 'codex'
              ? 'codex-settings'
              : provider === 'opencode'
                  ? 'opencode-settings'
                : 'claude-settings';
        const savedSettings = safeLocalStorage.getItem(settingsKey);
        if (savedSettings) {
          return JSON.parse(savedSettings);
        }
      } catch (error) {
        console.error('Error loading tools settings:', error);
      }

      return {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false,
      };
    };

    const toolsSettings = getToolsSettings();

    return {
      model: currentProviderModel,
      effort: currentProviderEffort,
      permissionMode: resolvePermissionModeForProvider(provider, permissionMode),
      toolsSettings,
      skipPermissions: toolsSettings?.skipPermissions || false,
      sessionSummary: getNotificationSessionSummary(selectedSession, currentInput),
    };
  }, [
    currentProviderEffort,
    currentProviderModel,
    permissionMode,
    provider,
    resolvePermissionModeForProvider,
    selectedSession,
  ]);

  // Allocate a stable backend session id for a brand-new conversation via the
  // session gateway (POST /api/providers/sessions). The complete selection —
  // provider, profile, and model — is sent in the same request so the session
  // row is created fully configured in one atomic operation. Returns null on
  // failure and logs; the caller decides what to do with the id — establish +
  // navigate in handleSubmit, or an out-of-band dispatch for a voice transcript
  // that resolved after the user left the origin chat.
  const createProviderSessionId = useCallback(
    async (args: {
      provider: LLMProvider;
      projectPath: string;
      providerProfileId: number | null;
      model: string;
    }): Promise<string | null> => {
      try {
        const response = await authenticatedFetch('/api/providers/sessions', {
          method: 'POST',
          body: JSON.stringify({
            provider: args.provider,
            projectPath: args.projectPath,
            providerProfileId: args.provider === 'claude' || args.provider === 'codex'
              ? args.providerProfileId
              : null,
            model: args.model,
          }),
        });
        if (!response.ok) {
          throw new Error(`Failed to create session (${response.status})`);
        }
        const body = await response.json();
        return body?.data?.sessionId || null;
      } catch (error) {
        console.error('Session creation failed:', error);
        return null;
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
      queuedSubmission?: QueuedDraft,
    ) => {
      event.preventDefault();
      if (
        isChatSubmissionBlocked(sendBlockedReason)
        || transportFailure?.action === 'send'
      ) {
        return;
      }
      const currentInput = queuedSubmission?.content ?? inputValueRef.current;
      const currentAttachments = queuedSubmission?.attachments ?? attachedFiles;
      const previouslyUploadedAttachments = queuedSubmission?.uploadedAttachments ?? [];
      if (
        (
          !currentInput.trim()
          && currentAttachments.length === 0
          && previouslyUploadedAttachments.length === 0
        )
        || !selectedProject
      ) {
        return;
      }

      // A turn is already in flight: stash this message instead of sending it.
      // Upload attached files now so the queued record contains durable image
      // descriptors that can be sent even if another session is open later.
      if (isLoading) {
        // A run can restart in the tiny gap between scheduling and flushing a
        // queued submission. Put the same durable draft back without uploading
        // its files again.
        if (queuedSubmission) {
          queuedDraftSessionRef.current = sessionKey;
          setQueuedDraft(queuedSubmission);
          return;
        }

        const queuedOptions = buildSendOptions(currentInput);
        const queuedSessionKey = sessionKey;
        let uploadedAttachments: unknown[] = [];
        try {
          uploadedAttachments = await uploadAttachmentFiles(currentAttachments);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Queued file upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload files: ${message}`,
            timestamp: new Date(),
          });
          return;
        }

        const durableDraft: QueuedDraft = {
          content: currentInput,
          attachments: currentAttachments,
          uploadedAttachments,
          options: queuedOptions,
        };
        if (queuedSessionKey) {
          // Write the claim ticket synchronously after upload; this closes the
          // gap before React's persistence effect runs.
          writeQueuedMessage(queuedSessionKey, {
            content: durableDraft.content,
            options: durableDraft.options,
            attachments: durableDraft.uploadedAttachments,
          });
        }

        // The upload is asynchronous. If the user changed sessions while it
        // was running, persist/send against the session where Queue was
        // pressed rather than putting the draft into the newly opened chat.
        if (queuedSessionKey && sessionKeyRef.current !== queuedSessionKey) {
          if (
            processingSessionsRef.current
            && !processingSessionsRef.current.has(queuedSessionKey)
          ) {
            const dispatched = sendMessage({
              type: 'chat.send',
              sessionId: queuedSessionKey,
              content: durableDraft.content,
              options: {
                ...(durableDraft.options ?? {}),
                attachments: durableDraft.uploadedAttachments ?? [],
              },
            });
            if (dispatched.ok) {
              clearQueuedMessage(queuedSessionKey);
              onSessionProcessing?.(queuedSessionKey, { statusText: null, canInterrupt: true });
            }
          }
          return;
        }

        queuedDraftSessionRef.current = queuedSessionKey;
        setQueuedDraft(durableDraft);
        setInput('');
        inputValueRef.current = '';
        setAttachedFiles([]);
        setUploadingFiles(new Map());
        setFileErrors(new Map());
        resetCommandMenuState();
        setIsTextareaExpanded(false);
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        // selectedProject is guaranteed by the guard at the top of handleSubmit.
        safeLocalStorage.removeItem(`draft_input_${selectedProject.projectId}`);
        return;
      }

      // Intercept slash commands only when "/" is the first input character.
      // Also accept exact "help" as a convenience alias for users who expect CLI-style help.
      const commandInput = currentInput.trimEnd();
      const isHelpAlias = commandInput.trim().toLowerCase() === 'help';
      if (commandInput.startsWith('/') || isHelpAlias) {
        const firstSpace = commandInput.indexOf(' ');
        const commandName = isHelpAlias
          ? '/help'
          : firstSpace > 0 ? commandInput.slice(0, firstSpace) : commandInput;
        const matchedCommand =
          slashCommands.find((cmd: SlashCommand) => cmd.name === commandName) ||
          (commandName === '/help'
            ? ({
                name: '/help',
                description: 'Show help documentation for Claude Code',
                namespace: 'builtin',
                metadata: { type: 'builtin' },
              } as SlashCommand)
            : undefined);
        if (matchedCommand && matchedCommand.type !== 'skill') {
          executeCommand(matchedCommand, isHelpAlias ? '/help' : commandInput);
          setInput('');
          inputValueRef.current = '';
          setAttachedFiles([]);
          setUploadingFiles(new Map());
          setFileErrors(new Map());
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
          return;
        }
      }

      const messageContent = currentInput;

      let uploadedAttachments = previouslyUploadedAttachments;
      if (uploadedAttachments.length === 0 && currentAttachments.length > 0) {
        try {
          uploadedAttachments = await uploadAttachmentFiles(currentAttachments);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('File upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload files: ${message}`,
            timestamp: new Date(),
          });
          return;
        }
      }

      const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';
      const sessionSummary = getNotificationSessionSummary(selectedSession, currentInput);

      // The conversation always has a stable backend-allocated session id
      // BEFORE the first websocket send: brand-new chats allocate one here
      // via the session gateway. There is no client-visible session-id
      // handoff later — this id stays valid for the conversation's lifetime.
      let targetSessionId = selectedSession?.id || currentSessionId || null;
      if (!targetSessionId) {
        targetSessionId = await createProviderSessionId({
          provider,
          projectPath: resolvedProjectPath,
          providerProfileId: provider === 'claude'
            ? selectedClaudeProfileId
            : provider === 'codex'
              ? selectedCodexProfileId
              : null,
          // The composer displays `currentProviderModel`; the first send
          // creates the session with exactly that model.
          model: currentProviderModel,
        });

        if (!targetSessionId) {
          addMessage({
            type: 'error',
            content: 'Failed to start a new session. Please try again.',
            timestamp: new Date(),
          });
          return;
        }

        onSessionEstablished?.(targetSessionId, {
          provider,
          project: selectedProject,
          summary: sessionSummary,
        });
      }

      const attachmentRecords = uploadedAttachments as ChatAttachment[];
      const userMessage: ChatMessage = {
        type: 'user',
        content: currentInput,
        images: attachmentRecords.filter(isImageAttachment),
        files: attachmentRecords.filter((attachment) => !isImageAttachment(attachment)),
        timestamp: new Date(),
      };

      // The browser WebSocket API accepts a frame synchronously. Do not
      // publish an optimistic row, mark a run, or clear the editable draft
      // until that acceptance succeeds; a reconnect race must be lossless.
      const dispatched = sendMessage({
        type: 'chat.send',
        sessionId: targetSessionId,
        content: messageContent,
        options: {
          ...(queuedSubmission?.options ?? buildSendOptions(messageContent)),
          attachments: uploadedAttachments,
        },
      });
      if (!dispatched.ok) {
        setTransportFailure({
          action: 'send',
          sessionId: targetSessionId,
          projectId: selectedProject.projectId,
          message: 'The chat connection closed before Send completed. Your draft is still here.',
        });
        return;
      }
      setTransportFailure(null);

      addMessage(userMessage);
      // Mark this request as processing in the per-session activity map (the
      // single source of truth the indicator derives from). The id is always
      // concrete at this point — no pending placeholder exists anymore.
      onSessionProcessing?.(targetSessionId, {
        statusText: null,
        canInterrupt: true,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      setInput('');
      inputValueRef.current = '';
      resetCommandMenuState();
      setAttachedFiles([]);
      setUploadingFiles(new Map());
      setFileErrors(new Map());
      setIsTextareaExpanded(false);

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      safeLocalStorage.removeItem(`draft_input_${selectedProject.projectId}`);
    },
    [
      selectedSession,
      attachedFiles,
      buildSendOptions,
      createProviderSessionId,
      currentProviderModel,
      currentSessionId,
      executeCommand,
      isLoading,
      onSessionProcessing,
      onSessionEstablished,
      provider,
      selectedClaudeProfileId,
      selectedCodexProfileId,
      resetCommandMenuState,
      scrollToBottom,
      sendBlockedReason,
      transportFailure?.action,
      selectedProject,
      sendMessage,
      sessionKey,
      addMessage,
      setIsUserScrolledUp,
      slashCommands,
    ],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  // Once the in-flight turn ends, replay the queued draft through the normal
  // submit path. The draft itself is passed directly so submission never
  // depends on React committing restored attachment state first.
  const wasLoadingRef = useRef(isLoading);
  const flushSessionKeyRef = useRef(sessionKey);
  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    wasLoadingRef.current = isLoading;

    // A session switch changes which session `isLoading` describes, so this
    // transition says nothing about the queued draft's own session. Never
    // flush across it — the swap effect below replaces `queuedDraft` with the
    // new session's saved draft right after this.
    if (flushSessionKeyRef.current !== sessionKey) {
      flushSessionKeyRef.current = sessionKey;
      return;
    }

    if (isLoading || !queuedDraft) {
      return;
    }

    // Turn just ended in this session: flush immediately. Otherwise this is a
    // saved draft restored into an apparently idle session — hold it briefly
    // so the `chat_subscribed` ack can flip `isLoading` if a run is actually
    // still live (the cleanup below cancels the send in that case).
    const delay = wasLoading ? 0 : 750;
    const timer = setTimeout(() => {
      // The saved key is the claim ticket shared with the app-level auto-send
      // (which handles sessions that finish while not viewed). If it's gone,
      // the message was already dispatched — don't send it twice.
      if (sessionKey && !readQueuedMessage(sessionKey)) {
        setQueuedDraft(null);
        return;
      }
      setQueuedDraft(null);
      setInput(queuedDraft.content);
      inputValueRef.current = queuedDraft.content;
      setAttachedFiles(queuedDraft.attachments);
      handleSubmitRef.current?.(createFakeSubmitEvent(), queuedDraft);
    }, delay);
    return () => clearTimeout(timer);
  }, [isLoading, queuedDraft, sessionKey, setInput]);

  const editQueuedDraft = useCallback(() => {
    if (!queuedDraft) {
      return;
    }
    setQueuedDraft(null);
    setInput(queuedDraft.content);
    inputValueRef.current = queuedDraft.content;
    setAttachedFiles(queuedDraft.attachments);
    textareaRef.current?.focus();
  }, [queuedDraft]);

  const deleteQueuedDraft = useCallback(() => {
    setQueuedDraft(null);
  }, []);

  // Snapshot which session a recording commits to, taken at stop/send time (while
  // the composer still points at that session). Threaded through useVoiceInput and
  // handed back to handleVoiceTranscript so a transcript that resolves after the
  // user switches sessions still lands where it was dictated.
  const captureVoiceOrigin = useCallback((): VoiceOrigin => ({
    key: selectedSession?.id || currentSessionId || null,
    viewKey: voiceViewKey,
    options: buildSendOptions(''),
    projectPath: selectedProject?.fullPath || selectedProject?.path || '',
    provider,
    providerProfileId: provider === 'claude'
      ? selectedClaudeProfileId
      : provider === 'codex'
        ? selectedCodexProfileId
        : null,
  }), [
    selectedSession,
    currentSessionId,
    voiceViewKey,
    buildSendOptions,
    selectedProject,
    provider,
    selectedClaudeProfileId,
    selectedCodexProfileId,
  ]);

  // Text that was in the box when a live dictation started. Partial transcripts are
  // rendered after it, so the growing preview never eats what the user already typed
  // and can be rolled back wholesale if the recording produces nothing. `null` means
  // no live preview is on screen.
  const voiceLiveBaseRef = useRef<string | null>(null);

  // Streaming STT (Soniox) reports words while the user is still speaking. Show them
  // in the composer as they arrive; `null` means the recording ended without a
  // transcript, so the preview is rolled back to the pre-dictation text.
  const handleVoiceInterim = useCallback((text: string | null) => {
    if (text === null) {
      const base = voiceLiveBaseRef.current;
      if (base === null) return;
      voiceLiveBaseRef.current = null;
      setInput(base);
      inputValueRef.current = base;
      return;
    }

    if (voiceLiveBaseRef.current === null) {
      voiceLiveBaseRef.current = inputValueRef.current.trim();
    }
    const base = voiceLiveBaseRef.current;
    const next = base ? `${base} ${text}` : text;
    setInput(next);
    inputValueRef.current = next;
  }, [setInput]);

  // A voice transcript either fills the input (to edit before sending) or, when the
  // user tapped "stop and send", is submitted straight away. Mirror the value into
  // inputValueRef synchronously so handleSubmit reads the new text, not the stale state.
  const handleVoiceTranscript = useCallback(async (
    text: string,
    send?: boolean,
    origin?: unknown,
    delivery?: VoiceTranscriptDelivery,
  ) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Read the chat on screen NOW (delivery time), not the one this callback closed
    // over when recording started.
    const activeViewKey = voiceViewKeyRef.current;
    const voiceOrigin = origin as VoiceOrigin | undefined;
    const originKey = voiceOrigin?.key ?? null;

    // The recording was committed in a chat that is no longer on screen — including a
    // brand-new chat whose session id was still null at commit time. Route the
    // transcript to that origin out-of-band instead of the composer's now-stale
    // current-session path — this both stops a switched-away transcript from
    // hijacking the open chat and lets a fresh recording start here undisturbed.
    if (
      voiceOrigin &&
      (isBackgroundVoiceOrigin(voiceOrigin.viewKey, activeViewKey) || delivery?.ownsUi === false)
    ) {
      let target = originKey;
      if (!target) {
        // Brand-new origin chat: allocate its session now so the transcript can be
        // addressed there as either a sent message or a retained draft. The
        // origin's snapshotted selection (including its model) is used.
        target = await createProviderSessionId({
          provider: voiceOrigin.provider,
          projectPath: voiceOrigin.projectPath,
          providerProfileId: voiceOrigin.providerProfileId,
          model: typeof voiceOrigin.options?.model === 'string' && voiceOrigin.options.model
            ? voiceOrigin.options.model
            : currentProviderModel,
        });
      }
      if (target) {
        if (send && !isChatSubmissionBlocked(sendBlockedReasonRef.current)) {
          // Same session-addressed dispatch the app-level auto-send uses; the backend
          // resolves provider/path from the session row. No optimistic addMessage —
          // the user message surfaces when they reopen the origin session.
          const dispatched = sendMessage({
            type: 'chat.send',
            sessionId: target,
            content: trimmed,
            options: { ...(voiceOrigin.options ?? {}), images: [] },
          });
          if (dispatched.ok) {
            onSessionProcessing?.(target, { statusText: null, canInterrupt: true });
          } else {
            writeQueuedMessage(target, { content: trimmed, options: voiceOrigin.options });
          }
        } else {
          // A fill-only transcript is persisted as that origin's draft, including
          // when the origin did not have a backend session id at commit time.
          writeQueuedMessage(target, { content: trimmed, options: voiceOrigin.options });
        }
      }
      return;
    }

    // Only a transcript for the chat on screen may replace its live preview. A
    // committed recording delivered to an older origin must leave a newer
    // recording's composer state untouched.
    if (voiceLiveBaseRef.current !== null) {
      setInput(voiceLiveBaseRef.current);
      inputValueRef.current = voiceLiveBaseRef.current;
      voiceLiveBaseRef.current = null;
    }

    // Origin is the open chat (or unknown / the same brand-new chat): fill the box
    // inline and, when the user tapped "stop and send", submit straight away.
    const base = inputValueRef.current.trim();
    const next = base ? `${base} ${trimmed}` : trimmed;
    setInput(next);
    inputValueRef.current = next;
    if (send) await handleSubmitRef.current?.(createFakeSubmitEvent());
  }, [sendMessage, onSessionProcessing, setInput, createProviderSessionId, currentProviderModel]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProjectId}`) || '';
    setInput((previous) => {
      const next = previous === savedInput ? previous : savedInput;
      inputValueRef.current = next;
      return next;
    });
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    if (input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProjectId}`, input);
    } else {
      safeLocalStorage.removeItem(`draft_input_${selectedProjectId}`);
    }
  }, [input, selectedProjectId]);

  // Persist the queued draft under its session's key. Must be defined BEFORE
  // the swap effect below: on a session switch there is one commit where
  // `sessionKey` already points at the new session while `queuedDraft` (and
  // the owner ref) still describe the old one — the ref mismatch makes this
  // effect skip that commit instead of writing/clearing across sessions.
  useEffect(() => {
    if (!sessionKey || queuedDraftSessionRef.current !== sessionKey) {
      return;
    }
    if (
      queuedDraft
      && (queuedDraft.content.trim() || (queuedDraft.uploadedAttachments?.length ?? 0) > 0)
    ) {
      writeQueuedMessage(sessionKey, {
        content: queuedDraft.content,
        options: queuedDraft.options,
        attachments: queuedDraft.uploadedAttachments,
      });
    } else {
      clearQueuedMessage(sessionKey);
    }
  }, [queuedDraft, sessionKey]);

  // Switching sessions swaps in that session's queued draft. Browser File
  // objects are local to the mounted composer, while their already-uploaded
  // descriptors restore from storage and remain sendable.
  useEffect(() => {
    queuedDraftSessionRef.current = sessionKey;
    if (!sessionKey) {
      setQueuedDraft(null);
      return;
    }
    setQueuedDraft(restoreQueuedDraft(sessionKey));
  }, [sessionKey]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    if (lastAutosizedInputRef.current === input) {
      return;
    }
    // Re-run for restored drafts and programmatic input changes. User typing is
    // already resized in onInput, so this avoids doing the same forced layout twice.
    resizeTextarea(textareaRef.current);
  }, [input, resizeTextarea]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  /* ---------------------------------------------------------------- */
  /*  ArrowUp / ArrowDown recall of the user's own past messages       */
  /* ---------------------------------------------------------------- */

  // Position in `historyEntriesRef`, counted from the newest: 0 = last message
  // sent, 1 = the one before it. `null` = not browsing; the box holds the draft.
  const historyIndexRef = useRef<number | null>(null);
  // Snapshot of the recall list, taken when browsing starts so the indices stay
  // stable if the transcript grows mid-navigation.
  const historyEntriesRef = useRef<string[]>([]);
  // The draft that was in the box before browsing began, restored on stepping
  // back down past the newest entry — the same courtesy a shell does.
  const historyDraftRef = useRef('');
  // Set when a recalled value is written, so the effect below can put the caret
  // at the end once React has committed the new textarea value.
  const pendingHistoryCaretRef = useRef(false);
  const chatMessagesRef = useRef(chatMessages);
  chatMessagesRef.current = chatMessages;

  const exitHistoryNavigation = useCallback(() => {
    historyIndexRef.current = null;
    historyEntriesRef.current = [];
    historyDraftRef.current = '';
  }, []);

  // A different conversation has different history; never carry it across.
  const historySessionKey = selectedSession?.id || currentSessionId || null;
  useEffect(() => {
    exitHistoryNavigation();
  }, [historySessionKey, exitHistoryNavigation]);

  // Sending the recalled message (or clearing the box any other way) ends
  // browsing, so the next ArrowUp rebuilds from the newest turn. Covers every
  // submit path in one place instead of each `setInput('')` call site.
  useEffect(() => {
    if (input === '' && historyIndexRef.current !== null) {
      exitHistoryNavigation();
    }
  }, [input, exitHistoryNavigation]);

  useEffect(() => {
    if (!pendingHistoryCaretRef.current) return;
    pendingHistoryCaretRef.current = false;
    const node = textareaRef.current;
    if (!node) return;
    node.selectionStart = node.value.length;
    node.selectionEnd = node.value.length;
    resizeTextarea(node);
  }, [input, resizeTextarea]);

  const applyRecalledInput = useCallback((next: string) => {
    setInput(next);
    inputValueRef.current = next;
    pendingHistoryCaretRef.current = true;
  }, []);

  /**
   * Walks the composer through previously sent messages, shell-style.
   *
   * Up only fires while the caret sits on the first line and Down only on the
   * last, so both keys keep their normal meaning inside a multi-line draft;
   * anything with a modifier, an active selection, or an open command/file menu
   * is left alone. Returns true when the key was consumed.
   */
  const handleHistoryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      if (event.nativeEvent.isComposing) return false;

      const node = event.currentTarget;
      const { selectionStart, selectionEnd, value } = node;
      if (selectionStart === null || selectionEnd === null) return false;
      if (selectionStart !== selectionEnd) return false;

      if (event.key === 'ArrowUp') {
        if (value.slice(0, selectionStart).includes('\n')) return false;

        if (historyIndexRef.current === null) {
          // Newest last, consecutive repeats collapsed — re-sending the same
          // text twice shouldn't cost two presses to walk past.
          const entries: string[] = [];
          for (const message of chatMessagesRef.current) {
            if (message.type !== 'user') continue;
            const text = String(message.content ?? '').trim();
            if (!text || entries[entries.length - 1] === text) continue;
            entries.push(text);
          }
          if (entries.length === 0) return false;
          historyEntriesRef.current = entries;
          historyDraftRef.current = value;
        }

        const entries = historyEntriesRef.current;
        const nextIndex = historyIndexRef.current === null ? 0 : historyIndexRef.current + 1;
        event.preventDefault();
        // Already at the oldest message: hold there rather than wrapping around.
        if (nextIndex >= entries.length) return true;
        historyIndexRef.current = nextIndex;
        applyRecalledInput(entries[entries.length - 1 - nextIndex]);
        return true;
      }

      if (historyIndexRef.current === null) return false;
      if (value.slice(selectionEnd).includes('\n')) return false;

      event.preventDefault();
      const nextIndex = historyIndexRef.current - 1;
      if (nextIndex < 0) {
        const draft = historyDraftRef.current;
        exitHistoryNavigation();
        applyRecalledInput(draft);
        return true;
      }
      historyIndexRef.current = nextIndex;
      applyRecalledInput(historyEntriesRef.current[historyEntriesRef.current.length - 1 - nextIndex]);
      return true;
    },
    [applyRecalledInput, exitHistoryNavigation],
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      // Typing over a recalled message makes it the user's own draft again, so
      // the next ArrowUp restarts from the newest entry.
      exitHistoryNavigation();

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [exitHistoryNavigation, handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }

      // After the menus: both of them own the arrow keys while open.
      if (handleHistoryKeyDown(event)) {
        return;
      }

      if (event.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
        event.preventDefault();
        cyclePermissionMode();
        return;
      }

      if (event.key === 'Enter') {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      cyclePermissionMode,
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleHistoryKeyDown,
      handleSubmit,
      sendByCtrlEnter,
      showCommandMenu,
      showFileDropdown,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      resizeTextarea(target);
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);
    },
    [resizeTextarea, setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    exitHistoryNavigation();
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [exitHistoryNavigation, resetCommandMenuState]);

  const setInputText = useCallback((next: string) => {
    setInput(next);
    inputValueRef.current = next;
    exitHistoryNavigation();
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea) resizeTextarea(textarea);
    });
  }, [exitHistoryNavigation, resizeTextarea]);

  const restoreDraft = useCallback((content: string, files: File[] = []) => {
    setInput(content);
    inputValueRef.current = content;
    setAttachedFiles(files.slice(0, 5));
    setUploadingFiles(new Map());
    setFileErrors(new Map());
    exitHistoryNavigation();
    resetCommandMenuState();
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      resizeTextarea(textarea);
      textarea.focus();
      textarea.setSelectionRange(content.length, content.length);
    });
  }, [exitHistoryNavigation, resetCommandMenuState, resizeTextarea]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      return;
    }

    const targetSessionId = selectedSession?.id || currentSessionId || null;
    if (!targetSessionId) {
      console.warn('Abort requested but no session ID is available.');
      return;
    }

    // The backend resolves the provider from the session row, so no provider
    // field is needed here.
    const dispatched = sendMessage({
      type: 'chat.abort',
      sessionId: targetSessionId,
    });
    if (!dispatched.ok) {
      setTransportFailure({
        action: 'stop',
        sessionId: targetSessionId,
        projectId: selectedProjectId ?? null,
        message: 'The chat connection closed before Stop was delivered. Reconnect and try again.',
      });
      return;
    }
    setTransportFailure(null);
  }, [canAbortSession, currentSessionId, selectedProjectId, selectedSession?.id, sendMessage]);

  const handleGrantToolPermission = useCallback(
    (suggestion: { entry: string; toolName: string }) => {
      if (!suggestion || provider !== 'claude') {
        return { success: false };
      }
      return grantClaudeToolPermission(suggestion.entry);
    },
    [provider],
  );

  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      const deliveredIds: string[] = [];
      validIds.forEach((requestId) => {
        const dispatched = sendMessage({
          type: 'chat.permission-response',
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
          rememberEntry: decision?.rememberEntry,
        });
        if (dispatched.ok) deliveredIds.push(requestId);
      });

      if (deliveredIds.length !== validIds.length) {
        setTransportFailure({
          action: 'permission',
          sessionId: sessionKey,
          projectId: selectedProjectId ?? null,
          message: 'The connection closed before your response was delivered. Your pending question is still available.',
        });
      } else {
        setTransportFailure(null);
      }

      setPendingPermissionRequests((previous) =>
        previous.filter((request) => !deliveredIds.includes(request.requestId)),
      );
    },
    [sendMessage, sessionKey, setPendingPermissionRequests],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
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
    filteredFiles: filteredFiles as MentionableFile[],
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
    openAttachmentPicker: open,
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
    clearTransportFailure: () => setTransportFailure(null),
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    commandModalPayload,
    closeCommandModal,
    showCostModal,
    buildSendOptions,
  };
}
