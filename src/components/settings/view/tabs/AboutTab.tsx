import { ExternalLink, LoaderCircle, MessageSquare, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '../../../../constants/branding';
import { PRODUCT_CONFIG } from '../../../../constants/config';
import { useVersionCheck } from '../../../../hooks/useVersionCheck';

export default function AboutTab() {
  const { t } = useTranslation('settings');
  const {
    updateAvailable,
    latestVersion,
    currentVersion,
    releaseInfo,
    isDesktopUpdater,
    desktopUpdaterState,
    checkForUpdates,
    restartAndInstall,
  } = useVersionCheck();
  const releasesUrl = releaseInfo?.htmlUrl || `${PRODUCT_CONFIG.repositoryUrl}/releases`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary shadow-sm">
          <MessageSquare className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-foreground" style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}>
              {PRODUCT_CONFIG.productName}
            </span>
            <a href={releasesUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              v{currentVersion}
            </a>
            {updateAvailable && latestVersion && !isDesktopUpdater && (
              <a href={releasesUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t('apiKeys.version.updateAvailable', { version: latestVersion })}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {isDesktopUpdater && desktopUpdaterState?.phase === 'ready' && (
              <button
                type="button"
                onClick={() => { void restartAndInstall().catch(() => undefined); }}
                className="inline-flex min-h-11 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Restart and update
              </button>
            )}
            {isDesktopUpdater && ['available', 'downloading', 'installing'].includes(desktopUpdaterState?.phase || '') && (
              <span className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-muted px-3 text-xs font-medium text-foreground" role="status">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                {desktopUpdaterState?.phase === 'installing'
                  ? 'Restarting…'
                  : desktopUpdaterState?.phase === 'downloading'
                    ? `Downloading ${Math.round(desktopUpdaterState.progress?.percent || 0)}%`
                    : 'Starting download…'}
              </span>
            )}
            {isDesktopUpdater && desktopUpdaterState?.phase === 'error' && (
              <button
                type="button"
                onClick={() => { void checkForUpdates().catch(() => undefined); }}
                className="inline-flex min-h-11 items-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Try update again
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Open-source AI coding assistant interface</p>
        </div>
      </div>

      <nav aria-label="Product links" className="flex flex-wrap gap-4 text-sm">
        <a href={PRODUCT_CONFIG.repositoryUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Source code <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a href={PRODUCT_CONFIG.documentationUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Documentation <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a href={PRODUCT_CONFIG.homepageUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Homepage <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </nav>

      <div className="border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">Licensed under AGPL-3.0</p>
      </div>
    </div>
  );
}
