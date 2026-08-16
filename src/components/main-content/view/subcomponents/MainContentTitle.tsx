import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileArchive, FileCode2, FileOutput, FileText, GitFork } from 'lucide-react';

import { api } from '../../../../utils/api';
import { useChatProviderState } from '../../../chat/hooks/useChatProviderState';
import type { SessionStore } from '../../../../stores/useSessionStore';
import { useSessionStoreRevision } from '../../../../stores/useSessionStore';
import ProviderModelPickerDialog, {
  type ProviderModelPickerSelection,
} from '../../../../shared/view/ProviderModelPickerDialog';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type {
  AppTab,
  Project,
  ProjectSession,
  SubagentTranscript,
  LLMProvider,
} from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import ActionMenu, { type ActionMenuItem } from '../../../../shared/view/ui/ActionMenu';
import {
  downloadHTML,
  downloadMarkdown,
  downloadPDF,
  EXPORT_FORMATS,
} from '../../../chat/utils/chatExport';
import { hydrateSessionMessagesForExport } from '../../../chat/utils/sessionExport';
import { downloadZipResponse } from '../../../chat/utils/zipExport';

type MainContentTitleProps = {
  sessionStore: SessionStore;
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  selectedSubagent: SubagentTranscript | null;
  shouldShowTasksTab: boolean;
  onNavigateToSession?: (sessionId: string) => void;
};

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string, pluginDisplayName?: string) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  if (activeTab === 'schedules') {
    return 'Schedules';
  }

  if (activeTab === 'browser') {
    return t('tabs.browser');
  }

  return 'Project';
}

function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
}

type SessionActionsProps = {
  sessionStore: SessionStore;
  session: ProjectSession;
  onNavigateToSession?: (sessionId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
};

type ChatExportFormat = (typeof EXPORT_FORMATS)[number]['id'];
type ActionFeedback = {
  flow: 'export' | 'fork';
  tone: 'error' | 'info' | 'success';
  message: string;
  retryFormat?: ChatExportFormat;
};

const EXPORT_ICONS = {
  markdown: FileText,
  html: FileCode2,
  pdf: FileOutput,
  zip: FileArchive,
} as const;

function localExportFilename(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'chat';
  return `${slug}-${new Date().toISOString().slice(0, 10)}`;
}

function SessionActions({ sessionStore, session, onNavigateToSession, t }: SessionActionsProps) {
  const [exportingFormat, setExportingFormat] = useState<ChatExportFormat | null>(null);
  const [isForking, setIsForking] = useState(false);
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  useSessionStoreRevision(sessionStore, session.id);

  // Sub-agent transcripts are read-only records of past runs; cloning or
  // exporting them as standalone chats would misrepresent the data.
  const isAgentTranscript = Boolean(session.parentSessionId);

  // Read-only access to the provider/model catalog so the fork dialog can show
  // the same picker as the chat composer. Forking does NOT mutate the source
  // session's provider/model — only the new one. The dialog itself reads the
  // shared selection catalog; this hook resolves the source session's real
  // model below.
  const { currentProviderModel } = useChatProviderState({ selectedSession: session, selectedProject: null });

  // The source selection comes from the session's own metadata and its real
  // recorded model — never the composer's stored per-provider default, which
  // may have been changed for other chats.
  const sourceProvider = (session.__provider ?? 'claude') as LLMProvider;
  const sourceProfileId = sourceProvider === 'claude' || sourceProvider === 'codex'
    ? session.__providerProfileId ?? null
    : null;
  // `currentProviderModel` resolves from the session row (the model the source
  // actually runs with) because the hook receives this session as selected.
  const sourceModel = currentProviderModel || null;

  const handleExport = useCallback(async (format: ChatExportFormat) => {
    if (exportingFormat) return;
    setExportingFormat(format);
    setFeedback(null);
    try {
      const title = getSessionTitle(session);
      const filename = localExportFilename(title);
      let successMessage = `${format.toUpperCase()} export downloaded.`;
      // Every format is derived from this request-specific immutable history
      // result. ZIP additionally proves the server archive contains this exact
      // canonical transcript before any browser download begins.
      const snapshot = await hydrateSessionMessagesForExport(
        (sessionId, options) => sessionStore.fetchFromServer(sessionId, options),
        session.id,
        () => sessionStore.getRevision(session.id),
      );
      const { messages, transcriptDigest, snapshotRevision } = snapshot;
      if (messages.length === 0) throw new Error('This conversation has no messages to export.');
      if (format === 'zip') {
        const response = await api.exportSession(session.id, 'zip', transcriptDigest);
        await downloadZipResponse(response, `${filename}.zip`, {
          sessionId: session.id,
          messages,
          transcriptDigest,
        }, () => {
          if (sessionStore.getRevision(session.id) !== snapshotRevision) {
            throw new Error('Conversation changed while Export was being prepared. Try Export again.');
          }
        });
      } else {
        if (format === 'markdown') downloadMarkdown(messages, `${filename}.md`, title);
        if (format === 'html') downloadHTML(messages, `${filename}.html`, title);
        if (format === 'pdf') {
          const outcome = await downloadPDF(messages, filename, title);
          if (outcome.status === 'cancelled') {
            setFeedback({ flow: 'export', tone: 'info', message: 'PDF export cancelled.' });
            return;
          }
          successMessage = outcome.status === 'saved'
            ? 'PDF export saved.'
            : 'PDF print dialog opened.';
        }
      }
      setFeedback({ flow: 'export', tone: 'success', message: successMessage });
    } catch (error) {
      setFeedback({
        flow: 'export',
        tone: 'error',
        message: error instanceof Error ? error.message : t('mainContent.exportSessionError'),
        retryFormat: format,
      });
    } finally {
      setExportingFormat(null);
    }
  }, [exportingFormat, session, sessionStore, t]);

  const handleForkConfirm = useCallback(
    async (selection: ProviderModelPickerSelection) => {
      if (isForking || !onNavigateToSession) return;
      setIsForking(true);
      setFeedback(null);
      try {
        // The complete target selection travels in the single fork request:
        // provider, profile, and model are validated and persisted by the
        // backend atomically — no separate active-model request afterwards.
        const response = await api.forkSession(session.id, {
          provider: selection.provider,
          providerProfileId: selection.providerProfileId,
          model: selection.model,
          carryContext: selection.carryContext,
        });
        const payload = await response.json();
        const newSessionId = payload?.data?.sessionId;
        if (!response.ok || !newSessionId) {
          throw new Error(
            payload?.message
            || (typeof payload?.error === 'string' ? payload.error : payload?.error?.message)
            || 'The fork did not return a session id.',
          );
        }

        // If the server carried over a handoff summary, flag the new session so
        // the chat view can show an informational banner until the first send.
        if (payload?.data?.forkContextCarried) {
          sessionStore.setPendingForkContext(newSessionId, true);
        }

        onNavigateToSession(newSessionId);
      } catch (forkError) {
        setFeedback({
          flow: 'fork',
          tone: 'error',
          message: forkError instanceof Error
            ? forkError.message
            : t('mainContent.forkSessionError', { defaultValue: 'Failed to fork this session.' }),
        });
      } finally {
        setIsForking(false);
      }
    },
    [session.id, onNavigateToSession, isForking, t, sessionStore],
  );

  if (isAgentTranscript) {
    return null;
  }

  return (
    <div className="relative flex w-[5.75rem] flex-shrink-0 items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setForkDialogOpen(true)}
        disabled={!onNavigateToSession || isForking}
        title={t('mainContent.forkSessionTitle')}
        aria-label={t('mainContent.forkSession')}
        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <GitFork className="h-4 w-4" aria-hidden />
      </button>
      <ActionMenu
        label="Export"
        ariaLabel="Export chat"
        icon={Download}
        iconOnly
        portal
        disabled={Boolean(exportingFormat)}
        triggerClassName="h-11 w-11 text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        items={EXPORT_FORMATS.map<ActionMenuItem>((format) => ({
          key: format.id,
          label: format.id === 'markdown' ? 'Markdown' : format.id.toUpperCase(),
          description: format.label,
          icon: EXPORT_ICONS[format.id],
          loading: exportingFormat === format.id,
          disabled: Boolean(exportingFormat && exportingFormat !== format.id),
          onSelect: () => { void handleExport(format.id); },
        }))}
      />

      {feedback && (
        <div
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          className="absolute right-0 top-full z-[65] mt-2 w-72 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
        >
          <p>{feedback.message}</p>
          <div className="mt-2 flex justify-end gap-2">
            {feedback.tone === 'error' && feedback.flow === 'export' && feedback.retryFormat && (
              <button
                type="button"
                onClick={() => { void handleExport(feedback.retryFormat!); }}
                className="min-h-11 rounded-md border border-border px-3 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Retry
              </button>
            )}
            {feedback.tone === 'error' && feedback.flow === 'fork' && (
              <button
                type="button"
                onClick={() => setForkDialogOpen(true)}
                className="min-h-11 rounded-md border border-border px-3 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="min-h-11 rounded-md px-3 py-2 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <ProviderModelPickerDialog
        open={forkDialogOpen}
        onOpenChange={setForkDialogOpen}
        sourceProvider={sourceProvider}
        sourceProfileId={sourceProfileId}
        sourceModel={sourceModel}
        onConfirm={(selection) => {
          void handleForkConfirm(selection);
        }}
      />
    </div>
  );
}

export default function MainContentTitle({
  sessionStore,
  activeTab,
  selectedProject,
  selectedSession,
  selectedSubagent,
  shouldShowTasksTab,
  onNavigateToSession,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;
  const displayedProvider = selectedSubagent?.provider ?? selectedSession?.__provider;
  const displayedTitle = selectedSubagent?.name
    ?? (selectedSession ? getSessionTitle(selectedSession) : '');

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <SessionProviderLogo provider={displayedProvider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-hidden">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            <h2 title={displayedTitle} className="truncate text-sm font-semibold leading-tight text-foreground">
              {displayedTitle}
            </h2>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">
              {selectedSubagent
                ? `${getSessionTitle(selectedSession)} · ${selectedProject.displayName}`
                : selectedProject.displayName}
            </div>
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            <div className="truncate text-xs leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName)}
            </h2>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</div>
          </div>
        )}
      </div>

      {activeTab === 'chat' && selectedSession && !selectedSubagent && (
        <SessionActions
          key={selectedSession.id}
          sessionStore={sessionStore}
          session={selectedSession}
          onNavigateToSession={onNavigateToSession}
          t={t}
        />
      )}
    </div>
  );
}
