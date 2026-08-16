import { useCallback, useEffect, useMemo, useState } from 'react';

import { PRODUCT_CONFIG } from '../constants/config';
import type { ReleaseInfo } from '../types/sharedTypes';

const CLIENT_VERSION = globalThis.__CLOUDCLI_VERSION__;
const CLIENT_BUILD_ID = globalThis.__CLOUDCLI_BUILD_ID__;
const DESKTOP_UPDATE_PHASES = new Set<DesktopUpdaterPhase>([
  'available',
  'downloading',
  'ready',
  'installing',
  'error',
]);

/** Compare release versions that use numeric dot-separated components. */
export const compareVersions = (firstVersion: string, secondVersion: string) => {
  const firstParts = firstVersion.split('.').map(Number);
  const secondParts = secondVersion.split('.').map(Number);

  for (let index = 0; index < Math.max(firstParts.length, secondParts.length); index += 1) {
    const firstPart = Number.isFinite(firstParts[index]) ? firstParts[index] : 0;
    const secondPart = Number.isFinite(secondParts[index]) ? secondParts[index] : 0;
    if (firstPart !== secondPart) return firstPart - secondPart;
  }
  return 0;
};

export type InstallMode = 'git' | 'npm';

function getDesktopUpdaterBridge() {
  if (typeof window === 'undefined') return undefined;
  return window.cloudcliDesktopUpdater;
}

function mapDesktopRelease(state: DesktopUpdaterState | null): ReleaseInfo | null {
  if (!state?.release) return null;
  return {
    title: state.release.title,
    body: state.release.notes,
    htmlUrl: state.release.releaseUrl,
    publishedAt: state.release.publishedAt || '',
  };
}

export const useVersionCheck = () => {
  const isDesktopUpdater = Boolean(getDesktopUpdaterBridge());
  const [webUpdateAvailable, setWebUpdateAvailable] = useState(false);
  const [webLatestVersion, setWebLatestVersion] = useState<string | null>(null);
  const [webReleaseInfo, setWebReleaseInfo] = useState<ReleaseInfo | null>(null);
  const [installMode, setInstallMode] = useState<InstallMode>('git');
  const [runningVersion, setRunningVersion] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [desktopUpdaterState, setDesktopUpdaterState] = useState<DesktopUpdaterState | null>(null);

  useEffect(() => {
    const bridge = getDesktopUpdaterBridge();
    if (!bridge) return undefined;

    let active = true;
    const unsubscribe = bridge.onStateChanged((state) => {
      if (active) setDesktopUpdaterState(state);
    });
    void bridge.getState()
      .then((state) => {
        if (active) setDesktopUpdaterState(state);
      })
      .catch((error) => {
        console.error('Desktop updater state failed:', error);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isDesktopUpdater) return undefined;

    const fetchHealth = async () => {
      try {
        const response = await fetch('/health');
        const data = await response.json();
        if (data.installMode === 'npm' || data.installMode === 'git') {
          setInstallMode(data.installMode);
        }
        if (typeof data.version === 'string' && data.version.length > 0) {
          setRunningVersion(data.version);
          // A buildId difference alone can be a development or packaging
          // mismatch; it does not prove that an update was installed.
          setRestartRequired(data.version !== CLIENT_VERSION);
        }
      } catch {
        // Keep the non-destructive defaults when health is unavailable.
      }
    };
    void fetchHealth();
    return undefined;
  }, [isDesktopUpdater]);

  useEffect(() => {
    if (isDesktopUpdater) return undefined;

    const checkVersion = async () => {
      try {
        const response = await fetch(PRODUCT_CONFIG.updateFeedUrl);
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          throw new Error(`Update feed returned ${response.status}.`);
        }
        const data = await response.json();
        if (!data.tag_name) {
          setWebUpdateAvailable(false);
          setWebLatestVersion(null);
          setWebReleaseInfo(null);
          return;
        }

        const latest = String(data.tag_name).replace(/^v/, '');
        setWebLatestVersion(latest);
        setWebUpdateAvailable(compareVersions(latest, CLIENT_VERSION) > 0);
        setWebReleaseInfo({
          title: data.name || data.tag_name,
          body: data.body || '',
          htmlUrl: data.html_url || `${PRODUCT_CONFIG.repositoryUrl}/releases/latest`,
          publishedAt: data.published_at || '',
        });
      } catch (error) {
        console.error('Version check failed:', error);
        setWebUpdateAvailable(false);
        setWebLatestVersion(null);
        setWebReleaseInfo(null);
      }
    };

    void checkVersion();
    const interval = window.setInterval(checkVersion, 5 * 60 * 1_000);
    return () => window.clearInterval(interval);
  }, [isDesktopUpdater]);

  const checkForUpdates = useCallback(async () => {
    const bridge = getDesktopUpdaterBridge();
    if (!bridge) return null;
    const state = await bridge.check();
    setDesktopUpdaterState(state);
    return state;
  }, []);

  const restartAndInstall = useCallback(async () => {
    const bridge = getDesktopUpdaterBridge();
    if (!bridge) throw new Error('Automatic desktop updates are unavailable in this build.');
    const state = await bridge.restartAndInstall();
    setDesktopUpdaterState(state);
    return state;
  }, []);

  const desktopReleaseInfo = useMemo(
    () => mapDesktopRelease(desktopUpdaterState),
    [desktopUpdaterState],
  );
  const desktopUpdateAvailable = Boolean(
    desktopUpdaterState?.release && DESKTOP_UPDATE_PHASES.has(desktopUpdaterState.phase),
  );

  return {
    updateAvailable: isDesktopUpdater ? desktopUpdateAvailable : webUpdateAvailable,
    latestVersion: isDesktopUpdater
      ? desktopUpdaterState?.release?.version || null
      : webLatestVersion,
    currentVersion: desktopUpdaterState?.currentVersion || CLIENT_VERSION,
    buildId: desktopUpdaterState?.buildId || CLIENT_BUILD_ID,
    releaseInfo: isDesktopUpdater ? desktopReleaseInfo : webReleaseInfo,
    installMode,
    runningVersion,
    restartRequired: isDesktopUpdater ? false : restartRequired,
    isDesktopUpdater,
    desktopUpdaterState,
    checkForUpdates,
    restartAndInstall,
  };
};
