import { Settings, ArrowUpCircle, Bug, AlertTriangle, LoaderCircle, RotateCw } from 'lucide-react';
import type { TFunction } from 'i18next';

import { IS_PLATFORM, PRODUCT_CONFIG } from '../../../../constants/config';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import ReportIssueButton from '../../../report-issue/ReportIssueButton';

type SidebarFooterProps = {
  updateAvailable: boolean;
  restartRequired: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  currentVersion: string;
  desktopUpdaterState: DesktopUpdaterState | null;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  t: TFunction;
};

export default function SidebarFooter({
  updateAvailable,
  restartRequired,
  releaseInfo,
  latestVersion,
  currentVersion,
  desktopUpdaterState,
  onShowVersionModal,
  onShowSettings,
  t,
}: SidebarFooterProps) {
  const updateStatus = desktopUpdaterState?.phase === 'ready'
    ? 'Ready to install'
    : desktopUpdaterState?.phase === 'downloading'
      ? `${Math.round(desktopUpdaterState.progress?.percent || 0)}% downloaded`
      : desktopUpdaterState?.phase === 'available'
        ? 'Starting download…'
        : desktopUpdaterState?.phase === 'error'
          ? 'Update needs attention'
          : t('version.updateAvailable');
  const UpdateIcon = desktopUpdaterState?.phase === 'downloading'
    ? LoaderCircle
    : desktopUpdaterState?.phase === 'ready'
      ? RotateCw
      : desktopUpdaterState?.phase === 'error'
        ? AlertTriangle
        : ArrowUpCircle;

  return (
    <div className="flex-shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      {/* Restart-required banner: the running server version differs from the
          installed/frontend version (updated but not restarted). */}
      {restartRequired && (
        <>
          <div className="nav-divider" />
          <div className="px-2 py-1.5 md:px-2 md:py-1.5">
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-300/60 bg-amber-50/80 px-2.5 py-2 dark:border-amber-700/40 dark:bg-amber-900/15">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
              <span className="min-w-0 flex-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('version.restartRequired')}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Update banner */}
      {updateAvailable && (
        <>
          <div className="nav-divider" />
          {/* Desktop update */}
          <div className="hidden px-2 py-1.5 md:block">
            <button
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-blue-50/80 dark:hover:bg-blue-900/15"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <UpdateIcon className={`h-4 w-4 text-blue-500 dark:text-blue-400 ${desktopUpdaterState?.phase === 'downloading' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-normal text-blue-600 dark:text-blue-300">
                  {releaseInfo?.title || `v${latestVersion}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {updateStatus}
                </span>
              </div>
            </button>
          </div>

          {/* Mobile update */}
          <div className="px-3 py-2 md:hidden">
            <button
              className="flex h-11 w-full items-center gap-3 rounded-xl border border-blue-200/60 bg-blue-50/80 px-3.5 transition-all active:scale-[0.98] dark:border-blue-700/40 dark:bg-blue-900/15"
              onClick={onShowVersionModal}
            >
              <div className="relative flex-shrink-0">
                <UpdateIcon className={`h-4 w-4 text-blue-500 dark:text-blue-400 ${desktopUpdaterState?.phase === 'downloading' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-normal text-blue-600 dark:text-blue-300">
                  {releaseInfo?.title || `v${latestVersion}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {updateStatus}
                </span>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Product actions + Settings */}
      <div className="nav-divider" />

      {/* Desktop Report Issue */}
      {PRODUCT_CONFIG.issueTrackerUrl && <div className="hidden px-2 pt-1.5 md:block">
        <ReportIssueButton
          label={t('actions.reportIssue')}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <Bug className="h-3.5 w-3.5" />
          <span className="text-sm">{t('actions.reportIssue')}</span>
        </ReportIssueButton>
      </div>}

      {/* Desktop settings */}
      <div className="hidden px-2 py-1.5 md:block">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          onClick={onShowSettings}
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="text-sm">{t('actions.settings')}</span>
        </button>
      </div>

      {/* Desktop version brand line (OSS mode only) */}
      {!IS_PLATFORM && (
        <div className="hidden px-3 py-2 text-center md:block">
          <a
            href={PRODUCT_CONFIG.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            CloudCLI v{currentVersion} – {t('branding.openSource')}
          </a>
        </div>
      )}

      {/* Mobile Report Issue */}
      {PRODUCT_CONFIG.issueTrackerUrl && <div className="px-3 pt-3 md:hidden">
        <ReportIssueButton
          label={t('actions.reportIssue')}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl bg-muted px-3.5 transition-all hover:bg-accent active:scale-[0.98]"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-background">
            <Bug className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="text-sm font-normal text-foreground">{t('actions.reportIssue')}</span>
        </ReportIssueButton>
      </div>}

      {/* Mobile settings */}
      <div className="px-3 pb-3 pt-2 md:hidden">
        <button
          className="flex h-10 w-full items-center gap-3 rounded-xl bg-muted/40 px-3.5 transition-all hover:bg-muted/60 active:scale-[0.98]"
          onClick={onShowSettings}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/80">
            <Settings className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="text-sm font-normal text-foreground">{t('actions.settings')}</span>
        </button>
      </div>
    </div>
  );
}
