import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  TouchEvent,
} from 'react';
import { PaperclipIcon, MessageSquareIcon, XIcon, Loader2, Wand2 } from 'lucide-react';

import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';
import { useHoldToTalk } from '../../hooks/useHoldToTalk';
import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import { readVoiceConfig, VOICE_CONFIG_SYNC_EVENT } from '../../../../hooks/useVoiceConfig';
import type { QueuedDraft } from '../../hooks/useChatComposerState';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import type { VoiceTranscriptDelivery } from '../../../../lib/finalizeVoiceTranscript';
import type { PendingPermissionRequest, PermissionMode } from '../../types/types';
import type {
  LLMProvider,
  ProviderModelOption,
  ProviderSelectionCatalog,
} from '../../../../types/app';
import {
  getProviderCatalogSendBlockReason,
} from '../../../../shared/providerSelectionCatalog';
import {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '../../../../shared/view/ui';
import { getTextDirection } from '../../../../utils/textDirection';
import {
  resolveChatPrimaryVisual,
  resolveChatRunControls,
  type ChatPrimaryAction,
} from '../../utils/chatRunControls';

import CommandMenu from './CommandMenu';
import ActivityIndicator from './ActivityIndicator';
import ComposerAttachment from './ComposerAttachment';
import VoiceInputButton from './VoiceInputButton';
import EnhanceTextModal from './EnhanceTextModal';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import TokenUsageSummary from './TokenUsageSummary';
import QueuedMessageCard from './QueuedMessageCard';
import ComposerModelMenu from './ComposerModelMenu';
import ComposerProviderMenu from './ComposerProviderMenu';
import ComposerPermissionMenu from './ComposerPermissionMenu';

interface MentionableFile {
  name: string;
  path: string;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  activity: SessionActivity | null;
  isLoading: boolean;
  primaryAction: ChatPrimaryAction;
  isSocketConnected: boolean;
  sendBlockedReason: string | null;
  transportFailure: {
    action: 'send' | 'stop' | 'permission';
    message: string;
    sessionId: string | null;
    projectId: string | null;
  } | null;
  onRetryConnection: () => void;
  onDismissTransportFailure: () => void;
  onAbortSession: () => void;
  permissionMode: PermissionMode | string;
  availablePermissionModes: (PermissionMode | string)[];
  onSelectPermissionMode: (mode: PermissionMode | string) => void;
  providerLabel: string;
  currentProvider: LLMProvider;
  currentProviderProfileId: number | null;
  onSelectProvider: (provider: LLMProvider, profileId: number | null) => void;
  /** True while an input-triggered provider switch (fork) is in flight. */
  providerSwitching?: boolean;
  /** Error message from a failed input-triggered provider switch, if any. */
  providerSwitchError?: string | null;
  onDismissProviderSwitchError?: () => void;
  effort: string;
  availableEffortOptions: NonNullable<ProviderModelOption['effort']>['values'];
  onSelectEffort: (effort: string) => void;
  model: string;
  availableModelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
  providerSelectionCatalog: ProviderSelectionCatalog | null;
  providerCatalogLoading: boolean;
  providerCatalogError: string | null;
  onRetryProviderCatalog: () => void;
  onOpenAgentSettings: () => void;
  tokenBudget: Record<string, unknown> | null;
  onShowTokenUsage: () => void;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  queuedDraft: QueuedDraft | null;
  onEditQueuedDraft: () => void;
  onDeleteQueuedDraft: () => void;
  attachedFiles: File[];
  onRemoveAttachment: (index: number) => void;
  uploadingFiles: Map<string, number>;
  fileErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openAttachmentPicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onVoiceTranscript?: (
    text: string,
    send?: boolean,
    origin?: unknown,
    delivery?: VoiceTranscriptDelivery,
  ) => void | Promise<void>;
  /**
   * Partial transcript from a streaming STT provider, shown in the box while the
   * user is still speaking. `null` clears the preview (recording ended with nothing).
   */
  onVoiceInterim?: (text: string | null) => void;
  /** Snapshots the session a recording commits to, captured at each stop/send press. */
  onVoiceCommit?: () => unknown;
  /**
   * Applies the enhanced text from the on-demand Enhance modal, replacing the
   * composer input.
   */
  onApplyEnhancedText?: (text: string) => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  isInputFocused?: boolean;
  onInputFocusChange?: (focused: boolean) => void;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
  /**
   * The chat currently on screen. When it changes while a recording/transcription is
   * still in flight, the shared voice state is detached so the new chat's composer is
   * usable immediately (the in-flight transcript still delivers to its origin chat).
   */
  viewedSessionKey?: string | null;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  activity,
  isLoading,
  primaryAction,
  isSocketConnected,
  sendBlockedReason,
  transportFailure,
  onRetryConnection,
  onDismissTransportFailure,
  onAbortSession,
  permissionMode,
  availablePermissionModes,
  onSelectPermissionMode,
  providerLabel,
  currentProvider,
  currentProviderProfileId,
  onSelectProvider,
  providerSwitching = false,
  providerSwitchError = null,
  onDismissProviderSwitchError,
  effort,
  availableEffortOptions,
  onSelectEffort,
  model,
  availableModelOptions,
  onSelectModel,
  modelsLoading,
  providerSelectionCatalog,
  providerCatalogLoading,
  providerCatalogError,
  onRetryProviderCatalog,
  onOpenAgentSettings,
  tokenBudget,
  onShowTokenUsage,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  onSubmit,
  isDragActive,
  queuedDraft,
  onEditQueuedDraft,
  onDeleteQueuedDraft,
  attachedFiles,
  onRemoveAttachment,
  uploadingFiles,
  fileErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openAttachmentPicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onVoiceTranscript,
  onVoiceInterim,
  onVoiceCommit,
  onApplyEnhancedText,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  isInputFocused = false,
  onInputFocusChange,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
  viewedSessionKey,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const commandMenuPosition = useMemo(() => {
    if (!isCommandMenuOpen) {
      return { top: 0, left: 16, bottom: 90 };
    }
    const textareaRect = textareaRef.current?.getBoundingClientRect();
    return {
      top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
      left: textareaRect ? textareaRect.left : 16,
      bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
    };
  }, [isCommandMenuOpen, textareaRef]);

  // Voice state is hosted here (not in the mic button) so the main Send button can stop
  // recording and send the transcript in one tap, the way the mic button drops it in the box.
  const voiceAvailable = useVoiceAvailable();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // Whether voice cleanup is enabled in settings, kept in sync across hook
  // instances via the config sync event so the Enhance button reflects live
  // settings changes made elsewhere (e.g. the Voice settings tab).
  const [cleanupEnabled, setCleanupEnabled] = useState(() => readVoiceConfig().cleanupEnabled);
  useEffect(() => {
    const sync = () => setCleanupEnabled(readVoiceConfig().cleanupEnabled);
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, sync);
    return () => window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, sync);
  }, []);
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const voiceErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVoiceError = useCallback((msg: string) => {
    setVoiceError(msg);
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
    voiceErrorTimer.current = setTimeout(() => setVoiceError(null), 4000);
  }, []);
  useEffect(() => () => {
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
  }, []);
  const noopTranscript = useCallback(() => {}, []);
  const { state: voiceState, stop: voiceStop, start: voiceStart, detach: voiceDetach } = useVoiceInput(
    onVoiceTranscript ?? noopTranscript,
    handleVoiceError,
    onVoiceInterim,
  );
  // Every stop/send press snapshots the session being viewed right now (via
  // onVoiceCommit) and binds it to the recording, so a transcript that resolves
  // after the user switches sessions is still delivered to where it was dictated.
  const voiceStopCommit = useCallback(
    (opts?: { send?: boolean }) => voiceStop({ send: opts?.send, origin: onVoiceCommit?.() }),
    [voiceStop, onVoiceCommit],
  );
  const voiceToggle = useCallback(() => {
    if (voiceState === 'recording') voiceStopCommit({ send: false });
    else if (voiceState === 'idle') voiceStart();
  }, [voiceState, voiceStopCommit, voiceStart]);
  // Reset the shared voice state when the viewed chat changes so a transcription
  // still resolving for the previous chat doesn't leave the new chat's mic/Send
  // buttons stuck in the spinner. The in-flight transcript keeps delivering to its
  // captured origin; the new chat gets a fresh, recordable composer. voiceState is
  // read via a ref so this fires on session change only, not on every transition.
  const voiceStateRef = useRef(voiceState);
  voiceStateRef.current = voiceState;
  const prevViewedSessionKeyRef = useRef(viewedSessionKey);
  useEffect(() => {
    if (prevViewedSessionKeyRef.current === viewedSessionKey) return;
    prevViewedSessionKeyRef.current = viewedSessionKey;
    if (voiceStateRef.current !== 'idle') voiceDetach();
  }, [viewedSessionKey, voiceDetach]);
  const { preferences } = useUiPreferences();
  useHoldToTalk(
    !!voiceAvailable && !!preferences.voiceEnabled && !!preferences.voiceHoldToTalk,
    () => voiceStart(),
    voiceStopCommit,
  );
  const isRecording = voiceState === 'recording';
  const isTranscribing = voiceState === 'transcribing';

  // Detect if the AskUserQuestion interactive panel is active
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion'
  );

  // Hide the thinking/status bar while any permission request is pending
  const hasPendingPermissions = pendingPermissionRequests.length > 0;
  const hasActivityIndicator = Boolean(activity && !hasPendingPermissions);

  const hasQueuedDraft = Boolean(queuedDraft);
  const canQueueDraft = isLoading && Boolean(input.trim() || attachedFiles.length > 0);
  const runControls = resolveChatRunControls({
    isRunning: isLoading,
    canInterrupt: Boolean(activity?.canInterrupt),
    hasDraft: canQueueDraft,
    connectionAvailable: isSocketConnected && transportFailure?.action !== 'stop',
  });
  const primaryVisual = resolveChatPrimaryVisual(isLoading, isTranscribing);
  const providerCatalogSendBlockReason = getProviderCatalogSendBlockReason(
    providerCatalogError,
    isLoading,
  );
  const connectionUnavailable = !isSocketConnected || Boolean(transportFailure);
  const connectionMessage = transportFailure?.message
    ?? 'Chat is reconnecting. Your draft and pending actions are preserved.';
  const submitHint = canQueueDraft
    ? hasQueuedDraft
      ? t('input.hintText.updateQueued', { defaultValue: 'Enter to update queued message' })
      : t('input.hintText.queue', { defaultValue: 'Enter to queue your next message' })
    : sendByCtrlEnter
      ? t('input.hintText.ctrlEnter')
      : t('input.hintText.enter');
  const queueAriaLabel = hasQueuedDraft
    ? t('input.queue.update', { defaultValue: 'Update queued message' })
    : t('input.queue.sendNext', { defaultValue: 'Queue next message' });
  const submitAriaLabel = isLoading ? t('input.stop') : t('input.send');
  const mainControlIsPrimary = primaryAction === (isLoading ? 'stop' : 'send');

  const handleFormSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    if (sendBlockedReason || transportFailure?.action === 'send') {
      event.preventDefault();
      return;
    }
    onSubmit(event);
  }, [onSubmit, sendBlockedReason, transportFailure?.action]);

  return (
    <div className="chat-composer-shell relative flex-shrink-0 px-2 pb-2 pt-0 sm:px-4 sm:pb-4 md:px-4 md:pb-6">
      {!hasPendingPermissions && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 w-[calc(100%-1rem)] max-w-[54.25rem] -translate-x-1/2 translate-y-px bg-transparent sm:w-[calc(100%-2rem)]">
          <ActivityIndicator activity={activity} isInputFocused={isInputFocused} />
        </div>
      )}

      {pendingPermissionRequests.length > 0 && (
        <div className="mx-auto mb-3 max-w-[54.25rem]">
          <PermissionRequestsBanner
            pendingPermissionRequests={pendingPermissionRequests}
            handlePermissionDecision={handlePermissionDecision}
            handleGrantToolPermission={handleGrantToolPermission}
            deliveryDisabled={connectionUnavailable}
            deliveryDisabledReason={connectionUnavailable ? connectionMessage : null}
          />
        </div>
      )}

      {queuedDraft && (
        <QueuedMessageCard
          content={queuedDraft.content}
          attachmentCount={
            queuedDraft.uploadedAttachments?.length ?? queuedDraft.attachments.length
          }
          onEdit={onEditQueuedDraft}
          onDelete={onDeleteQueuedDraft}
        />
      )}

      <div className="relative mx-auto max-w-[54.25rem]">
        {providerCatalogError && (
          <div
            id="provider-catalog-recovery"
            role="alert"
            className="mb-2 flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium">Providers could not be loaded.</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {providerCatalogSendBlockReason ?? providerCatalogError}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onRetryProviderCatalog}
                disabled={providerCatalogLoading}
                data-ux-primary={primaryAction === 'retry-catalog' ? 'true' : undefined}
                className={`min-h-11 rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60 ${
                  primaryAction === 'retry-catalog'
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-background text-foreground'
                }`}
              >
                {providerCatalogLoading ? 'Retrying…' : 'Retry'}
              </button>
              <button
                type="button"
                onClick={onOpenAgentSettings}
                className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open Agent Settings
              </button>
            </div>
          </div>
        )}
        {connectionUnavailable && (
          <div
            id="chat-connection-recovery"
            role="alert"
            className="mb-2 flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium">Chat connection unavailable.</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{connectionMessage}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onRetryConnection}
                data-ux-primary={primaryAction === 'retry-connection' ? 'true' : undefined}
                className={`min-h-11 rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  primaryAction === 'retry-connection'
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-background text-foreground'
                }`}
              >
                Retry connection
              </button>
              {transportFailure && (
                <button
                  type="button"
                  onClick={onDismissTransportFailure}
                  className="min-h-11 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )}

        {hasQuestionPanel ? (
          isLoading ? (
            <div className="flex items-center justify-end gap-3 rounded-lg border border-border bg-background p-2">
              {runControls.stopExplanation && (
                <span id="question-stop-unavailable-reason" className="text-xs text-muted-foreground">
                  {runControls.stopExplanation}
                </span>
              )}
              <button
                type="button"
                onClick={onAbortSession}
                disabled={runControls.mainDisabled}
                aria-label={t('input.stop')}
                aria-describedby={runControls.stopExplanation ? 'question-stop-unavailable-reason' : undefined}
                data-ux-primary={primaryAction === 'stop' ? 'true' : undefined}
                className={`min-h-11 rounded-md border px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
                  primaryAction === 'stop'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground'
                }`}
              >
                {t('input.stop')}
              </button>
            </div>
          ) : null
        ) : (
          <>
        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-xl border border-border/50 bg-card/95 shadow-lg backdrop-blur-md">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`cursor-pointer touch-manipulation border-b border-border/30 px-4 py-3 last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'text-foreground hover:bg-accent/50'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="text-sm font-medium">{file.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <PromptInput
          onSubmit={handleFormSubmit}
          status={isLoading ? 'streaming' : 'ready'}
          className={[
            isTextareaExpanded ? 'chat-input-expanded' : '',
            hasActivityIndicator ? 'rounded-t-none' : '',
          ].filter(Boolean).join(' ')}
          {...getRootProps()}
        >
          {isDragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/15">
              <div className="rounded-xl border border-border/30 bg-card p-4 shadow-lg">
                <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm font-medium">Drop files here</p>
              </div>
            </div>
          )}

          {attachedFiles.length > 0 && (
            <PromptInputHeader>
              <div className="rounded-xl bg-muted/40 p-2">
                <div className="flex flex-wrap gap-2">
                  {attachedFiles.map((file, index) => (
                    <ComposerAttachment
                      key={`${file.name}-${file.lastModified}-${index}`}
                      file={file}
                      onRemove={() => onRemoveAttachment(index)}
                      uploadProgress={uploadingFiles.get(file.name)}
                      error={fileErrors.get(file.name)}
                    />
                  ))}
                </div>
              </div>
            </PromptInputHeader>
          )}

          <input {...getInputProps()} aria-label={t('input.attachFiles')} />

          <PromptInputBody>
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
              <div
                dir={getTextDirection(input)}
                className="bidi-isolate chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 py-2 text-sm leading-6 text-transparent"
              >
                {renderInputWithMentions(input)}
              </div>
            </div>

            <PromptInputTextarea
              ref={textareaRef}
              className="bidi-isolate"
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={placeholder}
              aria-description={submitHint}
            />
        </PromptInputBody>

        {runControls.stopExplanation && (
          <div
            id="stop-unavailable-reason"
            className="border-t border-border/30 px-3 py-2 text-xs text-muted-foreground"
          >
            {runControls.stopExplanation}
          </div>
        )}

        <PromptInputFooter>
          <PromptInputTools className="min-w-0">
            <PromptInputButton
              tooltip={{ content: t('input.attachFiles') }}
              onClick={openAttachmentPicker}
              aria-label={t('input.attachFiles')}
            >
              <PaperclipIcon />
            </PromptInputButton>

            {onVoiceTranscript && voiceAvailable && (
              <VoiceInputButton state={voiceState} onToggle={voiceToggle} errorMsg={voiceError} />
            )}

            {onApplyEnhancedText && cleanupEnabled && hasInput && (
              <PromptInputButton
                tooltip={{ content: t('enhance', { defaultValue: 'Enhance' }) }}
                onClick={() => setEnhanceOpen(true)}
              >
                <Wand2 />
              </PromptInputButton>
            )}
            <TokenUsageSummary usage={tokenBudget} onClick={onShowTokenUsage} />

            <PromptInputButton
              tooltip={{ content: t('input.showAllCommands') }}
              onClick={onToggleCommandMenu}
              className="relative"
            >
              <MessageSquareIcon />
              {slashCommandsCount > 0 && (
                <span
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
                >
                  {slashCommandsCount}
                </span>
              )}
            </PromptInputButton>

            {hasInput && (
              <PromptInputButton
                tooltip={{ content: t('input.clearInput', { defaultValue: 'Clear input' }) }}
                onClick={onClearInput}
                className="hidden sm:flex"
              >
                <XIcon />
              </PromptInputButton>
            )}

          </PromptInputTools>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div
              role="group"
              aria-label="Chat configuration"
              className="flex shrink-0 items-center divide-x divide-border overflow-hidden rounded-lg border border-input bg-background"
            >
              <ComposerProviderMenu
                currentProvider={currentProvider}
                currentProfileId={currentProviderProfileId}
                onSelectProvider={onSelectProvider}
                disabled={providerSwitching}
                catalog={providerSelectionCatalog}
                loading={providerCatalogLoading}
                error={providerCatalogError}
              />

              {providerSwitchError && (
                <button
                  type="button"
                  onClick={onDismissProviderSwitchError}
                  className="h-11 min-w-0 truncate bg-destructive/10 px-2 text-xs text-destructive transition-colors hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-live="polite"
                  title={providerSwitchError}
                >
                  {providerSwitchError}
                </button>
              )}

              <ComposerModelMenu
                effort={effort}
                effortOptions={availableEffortOptions}
                onSelectEffort={onSelectEffort}
                model={model}
                modelOptions={availableModelOptions}
                onSelectModel={onSelectModel}
                modelsLoading={modelsLoading}
              />

              <ComposerPermissionMenu
                permissionMode={permissionMode}
                permissionModes={availablePermissionModes}
                onSelectPermissionMode={onSelectPermissionMode}
                providerLabel={providerLabel}
              />
            </div>

            {runControls.queueVisible && (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  onSubmit(event);
                }}
                aria-label={queueAriaLabel}
                title={queueAriaLabel}
                className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {hasQueuedDraft ? 'Update queue' : 'Queue'}
              </button>
            )}

            {!sendBlockedReason && transportFailure?.action !== 'send' && (
              <PromptInputSubmit
                onClick={
                  isLoading
                    ? onAbortSession
                    : isRecording
                      ? (e: MouseEvent<HTMLButtonElement>) => {
                          e.preventDefault();
                          voiceStopCommit({ send: true });
                        }
                      : undefined
                }
                disabled={
                  isLoading
                    ? runControls.mainDisabled
                    : isRecording
                      ? false
                      : isTranscribing
                        ? true
                        : !input.trim() && attachedFiles.length === 0
                }
                aria-label={submitAriaLabel}
                aria-describedby={
                  runControls.stopExplanation
                    ? 'stop-unavailable-reason'
                    : undefined
                }
                data-ux-primary={mainControlIsPrimary ? 'true' : undefined}
                title={submitAriaLabel}
                className={`h-11 w-11 sm:h-11 sm:w-11 ${
                  mainControlIsPrimary
                    ? ''
                    : 'border border-border bg-muted text-muted-foreground shadow-none hover:bg-muted'
                }`}
              >
                {primaryVisual === 'transcribing' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : undefined}
              </PromptInputSubmit>
            )}
          </div>
        </PromptInputFooter>
      </PromptInput>
          </>
        )}
      </div>

      {enhanceOpen && onApplyEnhancedText && (
        <EnhanceTextModal
          text={input}
          onUse={(enhanced) => {
            onApplyEnhancedText(enhanced);
            setEnhanceOpen(false);
          }}
          onClose={() => setEnhanceOpen(false)}
        />
      )}
    </div>
  );
}
