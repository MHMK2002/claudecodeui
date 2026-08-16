import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  LoaderCircle,
  RotateCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { IS_PLATFORM } from '../../../constants/config';
import type { InstallMode } from '../../../hooks/useVersionCheck';
import { Button, Dialog, DialogContent, DialogTitle } from '../../../shared/view/ui';
import type { ReleaseInfo } from '../../../types/sharedTypes';
import { authenticatedFetch } from '../../../utils/api';
import { copyTextToClipboard } from '../../../utils/clipboard';

interface VersionUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  releaseInfo: ReleaseInfo | null;
  currentVersion: string;
  latestVersion: string | null;
  installMode: InstallMode;
  isDesktopUpdater: boolean;
  desktopUpdaterState: DesktopUpdaterState | null;
  onCheckForUpdates: () => Promise<DesktopUpdaterState | null>;
  onRestartAndInstall: () => Promise<DesktopUpdaterState>;
}

const RELOAD_COUNTDOWN_START = 30;

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

function getDesktopStatus(state: DesktopUpdaterState | null) {
  switch (state?.phase) {
    case 'checking':
      return { label: 'Checking for updates…', detail: 'This usually takes only a moment.' };
    case 'available':
      return { label: 'Update found', detail: 'The download will start automatically.' };
    case 'downloading': {
      const percent = Math.round(state.progress?.percent || 0);
      const transferred = formatBytes(state.progress?.transferred || 0);
      const total = formatBytes(state.progress?.total || 0);
      return { label: `Downloading update — ${percent}%`, detail: `${transferred} of ${total}` };
    }
    case 'ready':
      return { label: 'Ready to install', detail: 'Restart the app to finish the update.' };
    case 'installing':
      return { label: 'Restarting to install…', detail: 'The app will reopen automatically.' };
    case 'error':
      return { label: 'Update could not be completed', detail: state.error?.message || 'Try checking again.' };
    case 'not-available':
      return { label: 'You are up to date', detail: 'No newer desktop release is available.' };
    case 'disabled':
      return { label: 'Automatic updates are unavailable', detail: state.disabledReason || 'Use a packaged desktop build.' };
    default:
      return { label: 'Preparing update…', detail: 'Waiting for the desktop updater.' };
  }
}

export function VersionUpgradeModal({
  isOpen,
  onClose,
  releaseInfo,
  currentVersion,
  latestVersion,
  installMode,
  isDesktopUpdater,
  desktopUpdaterState,
  onCheckForUpdates,
  onRestartAndInstall,
}: VersionUpgradeModalProps) {
  const { t } = useTranslation('common');
  const upgradeCommand = installMode === 'npm'
    ? t('versionUpdate.npmUpgradeCommand')
    : IS_PLATFORM
      ? 'npm run update:platform'
      : 'git checkout main && git pull && npm install';
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateOutput, setUpdateOutput] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [desktopActionError, setDesktopActionError] = useState('');
  const [reloadCountdown, setReloadCountdown] = useState<number | null>(null);

  const desktopInstalling = desktopUpdaterState?.phase === 'installing';
  const desktopStatus = getDesktopStatus(desktopUpdaterState);

  useEffect(() => {
    if (!IS_PLATFORM || reloadCountdown === null) return undefined;
    if (reloadCountdown <= 0) {
      window.location.reload();
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setReloadCountdown((previousCountdown) => previousCountdown === null
        ? null
        : Math.max(previousCountdown - 1, 0));
    }, 1_000);
    return () => window.clearTimeout(timeoutId);
  }, [reloadCountdown]);

  useEffect(() => {
    setDesktopActionError('');
  }, [desktopUpdaterState?.phase]);

  const handleWebUpdateNow = useCallback(async () => {
    setIsUpdating(true);
    setUpdateOutput('Starting update…\n');
    setReloadCountdown(IS_PLATFORM ? RELOAD_COUNTDOWN_START : null);
    setUpdateError('');

    try {
      const response = await authenticatedFetch('/api/system/update', { method: 'POST' });
      const rawBody = await response.text();
      let data: { output?: string; error?: string } | null = null;
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = null;
      }

      if (!data) {
        if (IS_PLATFORM) {
          setUpdateOutput((previous) => `${previous}\nUpdate started. The server appears to be restarting.\n`);
        } else {
          setReloadCountdown(null);
          const message = `The update endpoint returned an unexpected response (HTTP ${response.status}).`;
          setUpdateError(message);
          setUpdateOutput((previous) => `${previous}\nUpdate failed: ${message}\n`);
        }
        return;
      }

      if (response.ok) {
        setUpdateOutput((previous) => `${previous}${data.output || ''}\nUpdate completed successfully.\n`);
        if (!IS_PLATFORM) {
          setUpdateOutput((previous) => `${previous}Restart the server to apply the changes.\n`);
        }
      } else {
        setReloadCountdown(null);
        const message = data.error || 'Update failed';
        setUpdateError(message);
        setUpdateOutput((previous) => `${previous}\nUpdate failed: ${message}\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed.';
      if (IS_PLATFORM) {
        setUpdateOutput((previous) => `${previous}\nThe server connection closed while the update was applying.\n`);
      } else {
        setReloadCountdown(null);
        setUpdateError(message);
        setUpdateOutput((previous) => `${previous}\nUpdate failed: ${message}\n`);
      }
    } finally {
      setIsUpdating(false);
    }
  }, []);

  const handleDesktopCheck = useCallback(async () => {
    setDesktopActionError('');
    try {
      await onCheckForUpdates();
    } catch (error) {
      setDesktopActionError(error instanceof Error ? error.message : 'Could not check for updates.');
    }
  }, [onCheckForUpdates]);

  const handleDesktopInstall = useCallback(async () => {
    setDesktopActionError('');
    try {
      await onRestartAndInstall();
    } catch (error) {
      setDesktopActionError(error instanceof Error ? error.message : 'Could not start the installer.');
    }
  }, [onRestartAndInstall]);

  const handleOpenChange = (open: boolean) => {
    if (!open && !desktopInstalling) onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-labelledby="version-upgrade-title"
        className="max-h-[90vh] max-w-2xl overflow-y-auto p-0"
      >
        <div className="space-y-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Download className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle id="version-upgrade-title" className="block text-lg font-semibold text-foreground">
                  {isDesktopUpdater ? 'Desktop update' : t('versionUpdate.title')}
                </DialogTitle>
                <p className="truncate text-sm text-muted-foreground">
                  {releaseInfo?.title || t('versionUpdate.newVersionReady')}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              disabled={desktopInstalling}
              aria-label={t('versionUpdate.ariaLabels.closeModal')}
            >
              <X />
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <span className="block text-xs font-medium text-muted-foreground">{t('versionUpdate.currentVersion')}</span>
              <span className="mt-1 block font-mono text-sm text-foreground">v{currentVersion}</span>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <span className="block text-xs font-medium text-muted-foreground">{t('versionUpdate.latestVersion')}</span>
              <span className="mt-1 block font-mono text-sm text-foreground">{latestVersion ? `v${latestVersion}` : 'Checking…'}</span>
            </div>
          </div>

          {isDesktopUpdater && (
            <div
              className="rounded-lg border border-border bg-card p-4"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                {desktopUpdaterState?.phase === 'ready' ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                ) : desktopUpdaterState?.phase === 'error' ? (
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                ) : (
                  <LoaderCircle className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin text-primary motion-reduce:animate-none" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{desktopStatus.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{desktopStatus.detail}</p>
                  {desktopUpdaterState?.phase === 'downloading' && (
                    <div className="mt-3">
                      <div
                        className="h-2 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-label="Update download progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(desktopUpdaterState.progress?.percent || 0)}
                      >
                        <div
                          className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
                          style={{ width: `${desktopUpdaterState.progress?.percent || 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {desktopActionError && (
                <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {desktopActionError}
                </p>
              )}
            </div>
          )}

          {releaseInfo?.body && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-foreground">{t('versionUpdate.whatsNew')}</h3>
                {releaseInfo.htmlUrl && (
                  <a
                    href={releaseInfo.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('versionUpdate.viewFullRelease')}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-muted/40 p-4">
                <div className="prose prose-sm max-w-none text-sm text-foreground dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={changelogComponents}>
                    {cleanChangelog(releaseInfo.body)}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {!isDesktopUpdater && (updateOutput || updateError) && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">{t('versionUpdate.updateProgress')}</h3>
              {updateOutput && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-muted p-4">
                  <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">{updateOutput}</pre>
                </div>
              )}
              {IS_PLATFORM && reloadCountdown !== null && (
                <p className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground">
                  {reloadCountdown === 0
                    ? 'Refreshing now…'
                    : `Refreshing in ${reloadCountdown} ${reloadCountdown === 1 ? 'second' : 'seconds'}.`}
                </p>
              )}
              {updateError && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {updateError}
                </p>
              )}
            </div>
          )}

          {!isDesktopUpdater && !isUpdating && !updateOutput && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">{t('versionUpdate.manualUpgrade')}</h3>
              <div className="rounded-lg border border-border bg-muted p-3">
                <code className="font-mono text-sm text-foreground">{upgradeCommand}</code>
              </div>
              <p className="text-xs text-muted-foreground">{t('versionUpdate.manualUpgradeHint')}</p>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={desktopInstalling}>
              {updateOutput ? t('versionUpdate.buttons.close') : t('versionUpdate.buttons.later')}
            </Button>
            {isDesktopUpdater ? (
              desktopUpdaterState?.phase === 'ready' ? (
                <Button type="button" onClick={() => void handleDesktopInstall()}>
                  <RotateCw />
                  Restart and update
                </Button>
              ) : desktopUpdaterState?.phase === 'error' || desktopUpdaterState?.phase === 'not-available' ? (
                <Button type="button" onClick={() => void handleDesktopCheck()}>
                  <RotateCw />
                  Check again
                </Button>
              ) : desktopInstalling ? (
                <Button type="button" disabled>
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                  Restarting…
                </Button>
              ) : null
            ) : !updateOutput ? (
              <>
                <Button type="button" variant="outline" onClick={() => void copyTextToClipboard(upgradeCommand)}>
                  {t('versionUpdate.buttons.copyCommand')}
                </Button>
                <Button type="button" onClick={() => void handleWebUpdateNow()} disabled={isUpdating}>
                  {isUpdating && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
                  {isUpdating ? t('versionUpdate.buttons.updating') : t('versionUpdate.buttons.updateNow')}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const changelogComponents = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
      {children}
    </a>
  ),
};

const cleanChangelog = (body: string) => {
  if (!body) return '';
  return body
    .replace(/\b[0-9a-f]{40}\b/gi, '')
    .replace(/(?:^|\s|-)([0-9a-f]{7,10})\b/gi, '')
    .replace(/\*\*Full Changelog\*\*:.*$/gim, '')
    .replace(/https?:\/\/github\.com\/[^/]+\/[^/]+\/compare\/[^\s)]+/gi, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
};
