import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, GitFork } from 'lucide-react';

import { api, authenticatedFetch } from '../../../../utils/api';
import { useChatProviderState } from '../../../chat/hooks/useChatProviderState';
import { useSessionStore } from '../../../../stores/useSessionStore';
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

type MainContentTitleProps = {
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
  session: ProjectSession;
  onNavigateToSession?: (sessionId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
};

function SessionActions({ session, onNavigateToSession, t }: SessionActionsProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [isForking, setIsForking] = useState(false);
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const sessionStore = useSessionStore();

  // Sub-agent transcripts are read-only records of past runs; cloning or
  // exporting them as standalone chats would misrepresent the data.
  const isAgentTranscript = Boolean(session.parentSessionId);

  // Read-only access to the provider/model/profile catalog so the fork dialog
  // can show the same picker as the empty-state chat composer. Forking does
  // NOT mutate the source session's provider/model — only the new one.
  const {
    claudeModel,
    cursorModel,
    codexModel,
    opencodeModel,
    claudeProfiles,
    claudeProfilesLoading,
    selectedClaudeProfileId,
    codexProfiles,
    codexProfilesLoading,
    selectedCodexProfileId,
    providerModelCatalog,
    providerModelsLoading,
  } = useChatProviderState({ selectedSession: session, selectedProject: null });

  const sourceProvider = (session.__provider ?? 'claude') as LLMProvider;
  const sourceProfileId =
    sourceProvider === 'claude'
      ? selectedClaudeProfileId ?? session.__providerProfileId ?? null
      : sourceProvider === 'codex'
        ? selectedCodexProfileId ?? session.__providerProfileId ?? null
        : null;
  const sourceModel =
    sourceProvider === 'claude'
      ? claudeModel
      : sourceProvider === 'cursor'
        ? cursorModel
        : sourceProvider === 'codex'
          ? codexModel
          : opencodeModel;

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const response = await api.exportSession(session.id);
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      link.href = url;
      link.download = filenameMatch?.[1] ?? `${session.id}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.alert(t('mainContent.exportSessionError'));
    } finally {
      setIsExporting(false);
    }
  }, [session.id, isExporting, t]);

  const handleForkConfirm = useCallback(
    async (selection: ProviderModelPickerSelection) => {
      if (isForking || !onNavigateToSession) return;
      setIsForking(true);
      try {
        const response = await api.forkSession(session.id, {
          provider: selection.provider,
          providerProfileId: selection.providerProfileId,
          carryContext: selection.carryContext,
        });
        const payload = await response.json();
        const newSessionId = payload?.data?.sessionId;
        if (!response.ok || !newSessionId) {
          throw new Error('Fork did not return a session id');
        }

        // If the server carried over a handoff summary, flag the new session so
        // the chat view can show an informational banner until the first send.
        if (payload?.data?.forkContextCarried) {
          sessionStore.setPendingForkContext(newSessionId, true);
        }

        // If the user picked a model that's different from the source's,
        // pre-bind it on the new session so the first chat.send uses it.
        // Best-effort: a failure here shouldn't block navigation.
        if (selection.model && selection.model !== sourceModel) {
          try {
            await authenticatedFetch(
              `/api/providers/${selection.provider}/sessions/${encodeURIComponent(newSessionId)}/active-model`,
              {
                method: 'POST',
                body: JSON.stringify({ model: selection.model }),
              },
            );
          } catch (error) {
            console.warn('Failed to pre-bind fork model; continuing.', error);
          }
        }

        onNavigateToSession(newSessionId);
      } catch {
        window.alert(t('mainContent.exportSessionError'));
      } finally {
        setIsForking(false);
      }
    },
    [session.id, onNavigateToSession, isForking, t, sourceModel, sessionStore],
  );

  if (isAgentTranscript) {
    return null;
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => setForkDialogOpen(true)}
        disabled={!onNavigateToSession}
        title={t('mainContent.forkSessionTitle')}
        aria-label={t('mainContent.forkSession')}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <GitFork className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={handleExport}
        disabled={isExporting}
        title={t('mainContent.exportSessionTitle')}
        aria-label={t('mainContent.exportSession')}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
      </button>

      <ProviderModelPickerDialog
        open={forkDialogOpen}
        onOpenChange={setForkDialogOpen}
        sourceProvider={sourceProvider}
        sourceProfileId={sourceProfileId}
        sourceModel={sourceModel}
        claudeProfiles={claudeProfiles}
        codexProfiles={codexProfiles}
        providerModelCatalog={providerModelCatalog}
        providerModelsLoading={providerModelsLoading}
        claudeProfilesLoading={claudeProfilesLoading}
        codexProfilesLoading={codexProfilesLoading}
        onConfirm={(selection) => {
          void handleForkConfirm(selection);
        }}
      />
    </div>
  );
}

export default function MainContentTitle({
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
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <SessionProviderLogo provider={displayedProvider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
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
          session={selectedSession}
          onNavigateToSession={onNavigateToSession}
          t={t}
        />
      )}
    </div>
  );
}
