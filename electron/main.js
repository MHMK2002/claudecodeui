import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, session, shell, webContents } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readBuildIdentityFileSync } from '../shared/buildIdentity.js';
import productConfig from '../shared/product-config.json' with { type: 'json' };

import { CloudController } from './cloud.js';
import { DesktopWindowManager } from './desktopWindow.js';
import { DesktopNotificationsController } from './desktopNotifications.js';
import { DesktopDiagnostics, redactDiagnosticValue } from './diagnostics.js';
import {
  DESKTOP_UPDATER_CHANNELS,
  DesktopUpdaterController,
  createDesktopInstallPreparation,
  registerDesktopUpdaterIpc,
} from './desktopUpdater.js';
import { isExactVerifiedOrigin } from './localOrigin.js';
import { LocalServerController } from './localServer.js';
import { createDesktopPdfExporter, registerDesktopPdfExportHandler } from './pdfExport.js';
import { TabsController } from './tabs.js';
import { createVoiceSecureStorage } from './voiceSecureStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_NAME = productConfig.productName;
const CLOUD_ENABLED = productConfig.features.cloud === true;
const APP_USER_MODEL_ID = 'ai.cloudcli.desktop';
const CALLBACK_PROTOCOL = 'cloudcli';
const CALLBACK_URL = `${CALLBACK_PROTOCOL}://auth/callback`;
const CLOUDCLI_CONTROL_PLANE_URL = process.env.CLOUDCLI_CONTROL_PLANE_URL || productConfig.homepageUrl;
const REMOTE_START_TIMEOUT_MS = 30000;
const AUTH_CALLBACK_TTL_MS = 10 * 60 * 1000;

const tabs = new TabsController();

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let activeTarget = { kind: 'launcher', name: APP_NAME, url: null };
let desktopWindow = null;
let localServer = null;
let cloud = null;
let desktopNotifications = null;
let desktopUpdater = null;
let diagnostics = null;
let voiceSecureStorage = null;
let buildIdentity = null;
let localStartupFailure = null;
let isQuitting = false;
let isRefreshingCloud = false;
let pendingCloudConnectStartedAt = 0;

const exportDesktopPdf = createDesktopPdfExporter({
  BrowserWindow,
  dialog,
  getParentWindow: () => desktopWindow?.getMainWindow() ?? null,
});

function cloudDisabledError() {
  return new Error('Cloud is not available in this build.');
}

function createDisabledCloudController() {
  const reject = async () => { throw cloudDisabledError(); };
  return Object.freeze({
    getAccount: () => null,
    getAuthState: () => 'disabled',
    getEnvironments: () => [],
    getEnvironmentUrl: () => null,
    findEnvironment: () => null,
    buildConnectUrl: () => { throw cloudDisabledError(); },
    clearCloudAccount: async () => {},
    loadCloudAccount: async () => {},
    refreshCloudEnvironments: reject,
    saveFromCallback: reject,
    startEnvironmentAndWait: reject,
    stopEnvironment: reject,
    getEnvironmentCredentials: reject,
    getEnvironmentLaunchUrl: reject,
  });
}

function getAppRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
}

function getLauncherPath() {
  return path.join(__dirname, 'launcher', 'index.html');
}

function isTrustedDesktopChrome(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:'
      && path.resolve(fileURLToPath(parsed)) === path.resolve(getLauncherPath());
  } catch {
    return false;
  }
}

function getPreloadPath() {
  return path.join(__dirname, 'preload.cjs');
}

function getWindowIconPath() {
  if (process.platform === 'darwin') {
    return path.join(getAppRoot(), 'electron', 'assets', 'logo-macos.png');
  }
  return path.join(getAppRoot(), 'public', 'logo-512.png');
}

function getStorePath() {
  return path.join(app.getPath('userData'), 'cloud-account.json');
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function getDesktopNotificationsSettingsPath() {
  return path.join(app.getPath('userData'), 'desktop-notifications-settings.json');
}

function getVoiceSecureStoragePath() {
  return path.join(app.getPath('userData'), 'voice-secrets.json');
}

function getDiagnosticsDirectory() {
  return path.join(app.getPath('userData'), 'diagnostics');
}

function readBuildIdentity() {
  const appRoot = getAppRoot();
  const candidates = app.isPackaged
    ? [path.join(appRoot, 'dist', 'build-identity.json')]
    : [
        path.join(appRoot, '.build-identity', 'build-identity.json'),
        path.join(appRoot, 'dist', 'build-identity.json'),
      ];
  const identityPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!identityPath) {
    throw new Error(`Desktop build identity is missing. Checked: ${candidates.join(', ')}`);
  }
  return readBuildIdentityFileSync(identityPath, {
    expectedVersion: app.getVersion(),
    source: 'Desktop build identity',
  });
}

function getRunningEnvironmentUrls() {
  if (!CLOUD_ENABLED) return [];
  return cloud.getEnvironments()
    .filter((environment) => environment.status === 'running')
    .map((environment) => cloud.getEnvironmentUrl(environment))
    .filter(Boolean);
}

function getDisplayTargetName() {
  return activeTarget?.name || APP_NAME;
}

function getCloudState() {
  return {
    enabled: CLOUD_ENABLED,
    appVersion: buildIdentity.version,
    buildId: buildIdentity.buildId,
    account: cloud.getAccount(),
    environments: cloud.getEnvironments(),
    controlPlaneUrl: CLOUDCLI_CONTROL_PLANE_URL,
  };
}

function getLocalState() {
  return {
    desktopSettings: localServer.getSettings(),
    startupStage: localServer.getStartupStage(),
    localServerRunning: Boolean(localServer.getLocalServerUrl()),
    localWebUrl: localServer.getLocalServerUrl(),
    shareableWebUrl: localServer.getShareableWebUrl(),
    runtimeMode: localServer.getRuntimeMode(),
  };
}

function serializeEnvironment(environment) {
  return {
    id: environment.id,
    name: environment.name,
    subdomain: environment.subdomain,
    access_url: cloud.getEnvironmentUrl(environment),
    status: environment.status,
    created_at: environment.created_at,
    github_url: environment.github_url || null,
    region: environment.region || null,
    agent: environment.agent || null,
  };
}

function getDesktopState() {
  const cloudAccount = cloud.getAccount();
  const localState = getLocalState();
  const authState = cloud.getAuthState();
  return {
    productName: APP_NAME,
    features: productConfig.features,
    account: {
      connected: authState === 'connected',
      email: cloudAccount?.email || null,
      authState,
      requiresReconnect: authState === 'expired',
    },
    activeTarget,
    desktopSettings: localState.desktopSettings,
    localWebUrl: localState.localWebUrl,
    shareableWebUrl: localState.shareableWebUrl,
    localServerRunning: localState.localServerRunning,
    localStartupLogs: localServer.getStartupLogs(),
    localStartupStage: localState.startupStage,
    localStartupFailure,
    cloudLoading: CLOUD_ENABLED && isRefreshingCloud,
    tabs: tabs.getSerializableTabs(),
    activeTabId: tabs.activeTabId,
    environments: cloud.getEnvironments().map(serializeEnvironment),
    desktopNotifications: desktopNotifications?.getState() || { enabled: false, supported: false, connectedCount: 0, targetCount: 0 },
    desktopUpdater: desktopUpdater?.getState() || null,
  };
}

function broadcastDesktopUpdaterState(state) {
  const verifiedOrigin = localServer?.getVerifiedLocalOrigin();
  if (!verifiedOrigin) return;

  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    if (!isExactVerifiedOrigin(contents.getURL(), verifiedOrigin)) continue;
    contents.send(DESKTOP_UPDATER_CHANNELS.stateChanged, state);
  }
}

async function openExternalUrl(url) {
  if (String(url).startsWith(CALLBACK_PROTOCOL + "://")) {
    if (CLOUD_ENABLED) await handleDeepLink(url);
    return;
  }

  await shell.openExternal(url);
}

async function showError(title, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${title}: ${message}`);
  void diagnostics?.record('error.dialog', { title, message, stack: error?.stack });
  await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
    type: 'error',
    title,
    message: title,
    detail: message,
  });
}

function isExpectedNavigationAbort(error) {
  const message = error instanceof Error ? error.message : String(error);
  return error?.code === 'ERR_ABORTED' || message.includes('ERR_ABORTED') || message.includes('(-3)');
}

function syncDesktopState() {
  if (!desktopWindow) return;
  desktopWindow.buildAppMenu();
  desktopWindow.emitDesktopState();
  if (activeTarget?.kind === 'local' && !localServer?.getLocalServerUrl()) {
    void desktopWindow.showLocalStartupTarget(
      localServer.getPendingTarget(),
      localServer.getStartupLogs(),
      localServer.getStartupStage(),
    )
      .catch((error) => {
        if (isExpectedNavigationAbort(error)) return;
        void showError('Could not update local startup log', error);
      });
  }
}

function setActiveTarget(target) {
  activeTarget = target;
}

function getEnvironmentTarget(environment) {
  return {
    kind: 'remote',
    id: environment.id,
    name: environment.name || environment.subdomain,
    url: cloud.getEnvironmentUrl(environment),
  };
}

async function getEnvironmentLaunchTarget(environment) {
  const environmentUrl = cloud.getEnvironmentUrl(environment);
  return {
    ...getEnvironmentTarget(environment),
    url: environmentUrl,
    loadUrl: await cloud.getEnvironmentLaunchUrl(environment),
  };
}

async function hasCloudWebSession() {
  const cookies = await session.defaultSession.cookies.get({});
  return cookies.some((cookie) => {
    const cookieDomain = String(cookie.domain || '');
    return cookieDomain.includes('cloudcli.ai')
      && /-auth-token(?:\.\d+)?$/.test(cookie.name)
      && Boolean(cookie.value);
  });
}

function isCloudAuthRedirect(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const controlPlane = new URL(CLOUDCLI_CONTROL_PLANE_URL);
    return parsed.origin === controlPlane.origin
      && (parsed.pathname === '/login' || parsed.pathname.startsWith('/auth/'));
  } catch {
    return false;
  }
}

async function getDiagnosticsText() {
  const cloudAccount = cloud.getAccount();
  const localState = getLocalState();
  const diagnosticTail = await diagnostics?.tail(120).catch((error) => [
    JSON.stringify({ event: 'diagnostics.tail-failed', details: { message: error?.message || String(error) } }),
  ]);
  return JSON.stringify(redactDiagnosticValue({
    app: APP_NAME,
    version: buildIdentity.version,
    buildId: buildIdentity.buildId,
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    appPath: getAppRoot(),
    userDataPath: app.getPath('userData'),
    activeTarget,
    localServerUrl: localState.localWebUrl,
    localServerPort: localServer.localServerPort,
    localWebUrl: localState.localWebUrl,
    shareableWebUrl: localState.shareableWebUrl,
    desktopSettings: localState.desktopSettings,
    cloudConnected: Boolean(cloudAccount?.apiKey),
    cloudEmail: cloudAccount?.email || null,
    cloudEnvironmentCount: cloud.getEnvironments().length,
    cloudRunningEnvironmentCount: getRunningEnvironmentUrls().length,
    cloudAuthState: cloud.getAuthState(),
    cloudAccountPath: getStorePath(),
    controlPlaneUrl: CLOUDCLI_CONTROL_PLANE_URL,
    diagnosticsPath: diagnostics?.getPath() || null,
    diagnosticsTail: diagnosticTail || [],
  }), null, 2);
}

async function copyDiagnostics() {
  clipboard.writeText(await getDiagnosticsText());
  await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
    type: 'info',
    title: 'Diagnostics copied',
    message: 'CloudCLI desktop diagnostics were copied to the clipboard.',
  });
}

async function refreshCloudEnvironments({ showErrors = false } = {}) {
  if (!CLOUD_ENABLED) return [];
  isRefreshingCloud = true;
  syncDesktopState();
  try {
    return await cloud.refreshCloudEnvironments();
  } catch (error) {
    const authState = cloud.getAuthState();
    if (authState === 'expired') {
      const expiredError = new Error('Your CloudCLI session expired. Reconnect your account.');
      if (showErrors) {
        await showError('CloudCLI login required', expiredError);
        return [];
      }
      throw expiredError;
    }
    if (showErrors) {
      await showError('Could not load CloudCLI environments', error);
      return [];
    }
    throw error;
  } finally {
    isRefreshingCloud = false;
    void desktopNotifications?.sync().catch((error) => console.error('[DesktopNotifications] sync failed:', error?.message || error));
    syncDesktopState();
  }
}

async function connectCloudAccount() {
  if (!CLOUD_ENABLED) throw cloudDisabledError();
  const connectUrl = cloud.buildConnectUrl();
  pendingCloudConnectStartedAt = Date.now();
  clipboard.writeText(connectUrl);
  await openExternalUrl(connectUrl);
  return connectUrl;
}

async function handleDeepLink(url) {
  if (!CLOUD_ENABLED) return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  if (parsed.protocol !== `${CALLBACK_PROTOCOL}:` || parsed.hostname !== 'auth') {
    return;
  }

  if (!pendingCloudConnectStartedAt || Date.now() - pendingCloudConnectStartedAt > AUTH_CALLBACK_TTL_MS) {
    await showError('CloudCLI account connection failed', new Error('No recent CloudCLI account connection was started from this app.'));
    return;
  }

  const apiKey = parsed.searchParams.get('api_key');
  if (!apiKey) {
    await showError('CloudCLI account connection failed', new Error('The callback did not include an API key.'));
    return;
  }

  await cloud.saveFromCallback({
    apiKey,
    email: parsed.searchParams.get('email'),
  });
  pendingCloudConnectStartedAt = 0;
  await refreshCloudEnvironments({ showErrors: true });

  dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
    type: 'info',
    title: 'CloudCLI account connected',
    message: cloud.getAccount()?.email ? `Connected as ${cloud.getAccount().email}.` : 'CloudCLI account connected.',
  }).catch(() => {});
}

async function copyLocalWebUrl() {
  const shareableUrl = await localServer.createBrowserHandoffUrl();
  const localUrl = localServer.getLocalServerUrl();

  if (!shareableUrl) {
    throw new Error('Local CloudCLI URL is not available yet.');
  }

  clipboard.writeText(shareableUrl);
  const isLanUrl = shareableUrl !== localUrl;
  await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
    type: 'info',
    title: 'Web URL copied',
    message: isLanUrl ? 'LAN web URL copied.' : 'Local web URL copied.',
    detail: isLanUrl
      ? `${shareableUrl}\n\nUse this URL from another device on the same network.`
      : `${shareableUrl}\n\nThis URL works on this computer. Enable LAN access before starting Local CloudCLI to copy a phone-accessible URL.`,
  });

  return getDesktopState();
}

async function openLocalWebUi() {
  const url = await localServer.createBrowserHandoffUrl();
  if (!url) {
    throw new Error('Local CloudCLI URL is not available yet.');
  }

  await openExternalUrl(url);
  return getDesktopState();
}

async function updateDesktopSetting(key, value) {
  const result = await localServer.updateDesktopSetting(key, value);
  syncDesktopState();

  if (result.requiresRestartNotice) {
    await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
      type: 'info',
      title: 'Restart local server to apply',
      message: 'LAN access changes apply the next time the local server starts.',
      detail: 'Quit CloudCLI and stop the local server, then open Local CloudCLI again.',
    });
  }

  return getDesktopState();
}

async function showEnvironmentPicker() {
  if (!CLOUD_ENABLED) {
    await openLocalInDesktop();
    return getDesktopState();
  }
  let environments = cloud.getEnvironments();
  let refreshError = null;

  if (cloud.getAccount()?.apiKey) {
    try {
      environments = await refreshCloudEnvironments({ showErrors: false });
    } catch (error) {
      refreshError = error;
      console.warn('[Cloud] Could not refresh environments before showing picker:', error?.message || error);
    }
  }

  const choices = ['Local CloudCLI', ...environments.map((environment) => {
    const status = environment.status === 'running' ? '' : ` (${environment.status})`;
    return `${environment.name || environment.subdomain}${status}`;
  })];

  const response = await dialog.showMessageBox(desktopWindow?.getMainWindow(), {
    type: 'question',
    buttons: [...choices, 'Cancel'],
    defaultId: 0,
    cancelId: choices.length,
    title: 'Switch CloudCLI Environment',
    message: 'Choose where this desktop window should connect.',
    detail: refreshError ? `Cloud environments could not be refreshed. Showing cached environments.\n\n${refreshError.message || refreshError}` : undefined,
  });

  if (response.response === choices.length) return getDesktopState();
  if (response.response === 0) return openLocalInDesktop();
  return openEnvironmentInDesktop(environments[response.response - 1]);
}

async function startEnvironment(environment) {
  if (!CLOUD_ENABLED) throw cloudDisabledError();
  await cloud.startEnvironmentAndWait(environment, REMOTE_START_TIMEOUT_MS);
  await refreshCloudEnvironments({ showErrors: true });
  return getDesktopState();
}

async function stopEnvironment(environment) {
  if (!CLOUD_ENABLED) throw cloudDisabledError();
  await cloud.stopEnvironment(environment);
  await refreshCloudEnvironments({ showErrors: true });
  return getDesktopState();
}

async function openEnvironmentInBrowser(environment) {
  if (!CLOUD_ENABLED) throw cloudDisabledError();
  await openExternalUrl(await cloud.getEnvironmentLaunchUrl(environment));
  return getDesktopState();
}

function getProjectFolder(environment) {
  return String(environment.name || environment.subdomain || 'workspace').replace(/[^a-zA-Z0-9-]/g, '');
}

function getSshTarget(credentials) {
  if (credentials.ssh_command) {
    const parts = String(credentials.ssh_command).split(/\s+/);
    if (parts.length >= 2) return parts[1];
  }
  return `${credentials.username}@ssh.cloudcli.ai`;
}

function getSshHost(credentials) {
  const target = getSshTarget(credentials);
  const atIndex = target.indexOf('@');
  return atIndex >= 0 ? target.slice(atIndex + 1) : 'ssh.cloudcli.ai';
}

function getSafeSshUsername(credentials) {
  const username = String(credentials.username || '');
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    throw new Error('Cloud environment returned an invalid SSH username.');
  }
  return username;
}

function getSafeSshHost(credentials) {
  const host = getSshHost(credentials);
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
    throw new Error('Cloud environment returned an invalid SSH host.');
  }
  return host;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function getEnvironmentCredentials(environment) {
  const credentials = await cloud.getEnvironmentCredentials(environment);
  if (credentials.password) {
    clipboard.writeText(credentials.password);
  }
  return credentials;
}

async function openEnvironmentInIde(environment, ide) {
  if (!CLOUD_ENABLED) throw cloudDisabledError();
  const credentials = await getEnvironmentCredentials(environment);
  const scheme = ide === 'cursor' ? 'cursor' : 'vscode';
  const remoteUri = `${scheme}://vscode-remote/ssh-remote+${getSafeSshUsername(credentials)}@${getSafeSshHost(credentials)}/workspace/${getProjectFolder(environment)}?windowId=_blank`;
  await shell.openExternal(remoteUri);
  return getDesktopState();
}

async function openEnvironmentInSsh(environment) {
  if (!CLOUD_ENABLED) throw cloudDisabledError();
  const credentials = await getEnvironmentCredentials(environment);
  const remoteCommand = `cd /workspace/${getProjectFolder(environment)} && exec $SHELL -l`;
  const sshCommand = `ssh -t ${shellQuote(getSshTarget(credentials))} ${shellQuote(remoteCommand)}`;

  if (process.platform === 'darwin') {
    const escaped = sshCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    spawn('osascript', ['-e', `tell application "Terminal" to do script "${escaped}"`], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    clipboard.writeText(sshCommand);
    await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
      type: 'info',
      title: 'SSH command copied',
      message: 'The SSH command was copied to the clipboard.',
      detail: sshCommand,
    });
  }

  return getDesktopState();
}

async function copyEnvironmentMobileUrl(environment) {
  const url = cloud.getEnvironmentUrl(environment);
  clipboard.writeText(url);
  await dialog.showMessageBox(desktopWindow?.getMainWindow() || undefined, {
    type: 'info',
    title: 'Environment URL copied',
    message: 'Use this URL from your mobile browser.',
    detail: url,
  });
  return getDesktopState();
}

async function openCloudDashboard() {
  if (!CLOUD_ENABLED) throw cloudDisabledError();
  await openExternalUrl(CLOUDCLI_CONTROL_PLANE_URL);
  return getDesktopState();
}

function getActiveRemoteEnvironment() {
  if (activeTarget?.kind !== 'remote') return null;
  return cloud.findEnvironment(activeTarget.id);
}

async function runActiveEnvironmentAction(action) {
  if (!CLOUD_ENABLED) throw cloudDisabledError();
  const environment = getActiveRemoteEnvironment();
  if (!environment) {
    throw new Error('Open a cloud environment first.');
  }

  switch (action) {
    case 'web':
      return openEnvironmentInBrowser(environment);
    case 'vscode':
      return openEnvironmentInIde(environment, 'vscode');
    case 'cursor':
      return openEnvironmentInIde(environment, 'cursor');
    case 'ssh':
      return openEnvironmentInSsh(environment);
    case 'mobile':
      return copyEnvironmentMobileUrl(environment);
    default:
      throw new Error(`Unknown environment action: ${action}`);
  }
}

async function openLocalInDesktop({ repair = false } = {}) {
  const existingTab = tabs.getTab('local');
  if (!repair && existingTab && localServer.getLocalServerUrl()) {
    await localServer.bootstrapLocalSession(session.defaultSession);
    await desktopWindow.showTarget(await localServer.getResolvedTarget());
    return getDesktopState();
  }

  localStartupFailure = null;
  const pendingTarget = localServer.getPendingTarget();
  tabs.upsertTarget(pendingTarget);
  setActiveTarget(pendingTarget);
  const showStartupStage = async (stage) => {
    localServer.setStartupStage(stage);
    await desktopWindow.showLocalStartupTarget(
      pendingTarget,
      localServer.getStartupLogs(),
      stage,
    );
    desktopWindow.emitDesktopState();
  };
  await showStartupStage('starting-local-server');

  try {
    if (repair) {
      await localServer.restartAndRepair();
    } else {
      await localServer.ensureLocalServer();
    }
    await showStartupStage('checking-compatibility');
    const target = await localServer.getResolvedTarget();
    await showStartupStage('opening-workspace');
    await localServer.bootstrapLocalSession(session.defaultSession);
    await desktopWindow.showTarget(target);
    localServer.setStartupStage('idle');
    desktopWindow.emitDesktopState();
    return getDesktopState();
  } catch (error) {
    localServer.setStartupStage('failed');
    localStartupFailure = {
      kind: repair || error?.code === 'LOCAL_SERVER_COMPATIBILITY' ? 'compatibility' : 'startup',
      message: String(redactDiagnosticValue(error?.message || String(error))),
    };
    await desktopWindow.showLauncher();
    desktopWindow.emitDesktopState();
    throw error;
  }
}

async function openEnvironmentInDesktop(environment) {
  if (!CLOUD_ENABLED) throw cloudDisabledError();
  const pendingTarget = getEnvironmentTarget(environment);
  const tabId = tabs.getTabIdForTarget(pendingTarget);
  const hadTab = Boolean(tabs.getTab(tabId));
  const previousTabId = tabs.activeTabId;

  if (!hadTab) {
    await desktopWindow.showTabPlaceholder(
      pendingTarget,
      `${environment.status === 'running' ? 'Opening' : 'Starting'} ${pendingTarget.name}...`,
    );
    tabs.upsertTarget(pendingTarget);
    desktopWindow.emitDesktopState();
  }

  let nextEnvironment = environment;

  if (environment.status !== 'running') {
    const response = await dialog.showMessageBox(desktopWindow?.getMainWindow(), {
      type: 'question',
      buttons: ['Start Environment', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Start environment?',
      message: `${pendingTarget.name} is ${environment.status}.`,
      detail: 'CloudCLI can start it before opening the remote app.',
    });

    if (response.response !== 0) {
      if (!hadTab) {
        tabs.remove(tabId);
        desktopWindow.destroyTabView(tabId);
        if (previousTabId && previousTabId !== tabId) {
          await desktopWindow.switchDesktopTab(previousTabId);
        } else {
          await desktopWindow.showLauncher();
        }
      }
      return getDesktopState();
    }

    if (hadTab) {
      await desktopWindow.showTabPlaceholder(pendingTarget, `Starting ${pendingTarget.name}...`);
      tabs.upsertTarget(pendingTarget);
      desktopWindow.emitDesktopState();
    }

    nextEnvironment = await cloud.startEnvironmentAndWait(environment, REMOTE_START_TIMEOUT_MS);
  }

  let target = getEnvironmentTarget(nextEnvironment);
  if (!(await hasCloudWebSession())) {
    target = await getEnvironmentLaunchTarget(nextEnvironment);
  }

  const usedBootstrap = Boolean(target.loadUrl);
  const finalUrl = await desktopWindow.showTarget(target);
  if (!usedBootstrap && isCloudAuthRedirect(finalUrl)) {
    const bootstrapTarget = await getEnvironmentLaunchTarget(nextEnvironment);
    bootstrapTarget.forceLoad = true;
    await desktopWindow.showTarget(bootstrapTarget);
  }
  return getDesktopState();
}

function findEnvironmentByUrl(environmentUrl) {
  const targetOrigin = (() => {
    try {
      return new URL(environmentUrl).origin;
    } catch {
      return null;
    }
  })();
  if (!targetOrigin) return null;

  return cloud.getEnvironments().find((environment) => {
    try {
      return new URL(cloud.getEnvironmentUrl(environment)).origin === targetOrigin;
    } catch {
      return false;
    }
  }) || null;
}

async function openNotificationTarget({ environmentUrl, sessionId = null }) {
  const window = desktopWindow?.getMainWindow();
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  const environment = findEnvironmentByUrl(environmentUrl);
  if (environment) {
    await openEnvironmentInDesktop(environment);
  } else {
    const parsed = new URL(environmentUrl);
    await desktopWindow.showTarget({
      kind: 'remote',
      name: parsed.hostname,
      url: parsed.origin,
    });
  }

  const targetUrl = new URL(sessionId ? `/session/${encodeURIComponent(sessionId)}` : '/', environmentUrl).toString();
  await desktopWindow.navigateActiveView(targetUrl);
  return getDesktopState();
}

async function getEnvironmentAuthToken(environmentUrl) {
  return (await desktopWindow?.readAuthTokenForTarget(environmentUrl)) || null;
}

async function clearCloudAccount() {
  if (!CLOUD_ENABLED) return getDesktopState();
  await cloud.clearCloudAccount();
  desktopNotifications?.stop();
  const removedTabs = tabs.removeByKind('remote');
  for (const tab of removedTabs) {
    desktopWindow?.destroyTabView(tab.id);
  }
  if (activeTarget?.kind === 'remote') {
    await desktopWindow?.showLauncher();
  } else {
    syncDesktopState();
  }
  return getDesktopState();
}

function getRemoteEnvironmentMenuItems() {
  if (!CLOUD_ENABLED) return [];
  const cloudAccount = cloud.getAccount();
  const environments = cloud.getEnvironments();

  if (!cloudAccount?.apiKey) {
    return [{ label: 'Connect CloudCLI Account...', click: () => void connectCloudAccount() }];
  }

  if (!environments.length) {
    return [{ label: 'No environments found', enabled: false }];
  }

  return environments.map((environment) => ({
    label: `${environment.name || environment.subdomain}${environment.status === 'running' ? '' : ` (${environment.status})`}`,
    click: () => void openEnvironmentInDesktop(environment)
      .catch((error) => showError('Could not open environment', error)),
  }));
}

function registerProtocolHandler() {
  if (!CLOUD_ENABLED) return;
  const appEntry = path.join(getAppRoot(), 'electron', 'main.js');
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(CALLBACK_PROTOCOL, process.execPath, [appEntry]);
  } else {
    app.setAsDefaultProtocolClient(CALLBACK_PROTOCOL);
  }
}

function registerIpcHandlers() {
  registerDesktopPdfExportHandler({
    ipcMain,
    getVerifiedOrigin: () => localServer?.getVerifiedLocalOrigin(),
    exportPdf: exportDesktopPdf,
  });

  registerDesktopUpdaterIpc({
    ipcMain,
    controller: desktopUpdater,
    getVerifiedOrigin: () => localServer?.getVerifiedLocalOrigin(),
  });

  ipcMain.handle('cloudcli-desktop:renew-local-session', async (event) => {
    const authorized = isExactVerifiedOrigin(event.senderFrame?.url, localServer?.getVerifiedLocalOrigin());
    void diagnostics?.record('local-session.renew', { authorized, senderUrl: event.senderFrame?.url });
    if (!authorized) throw new Error('Local session renewal is unavailable for this page.');
    return localServer.bootstrapLocalSession(session.defaultSession);
  });

  ipcMain.handle('cloudcli-desktop:get-voice-secrets', async (event) => {
    const authorized = isExactVerifiedOrigin(event.senderFrame?.url, localServer?.getVerifiedLocalOrigin());
    if (!authorized) throw new Error('Voice secure storage is unavailable for this page.');
    return voiceSecureStorage.read();
  });

  ipcMain.handle('cloudcli-desktop:set-voice-secrets', async (event, patch) => {
    const authorized = isExactVerifiedOrigin(event.senderFrame?.url, localServer?.getVerifiedLocalOrigin());
    if (!authorized) throw new Error('Voice secure storage is unavailable for this page.');
    return voiceSecureStorage.write(patch);
  });

  ipcMain.handle('cloudcli-desktop:copy-diagnostics', async () => {
    await copyDiagnostics();
    return getDesktopState();
  });

  ipcMain.handle('cloudcli-desktop:copy-local-web-url', async () => copyLocalWebUrl());
  ipcMain.handle('cloudcli-desktop:get-state', () => getDesktopState());
  ipcMain.handle('cloudcli-desktop:open-local', async () => openLocalInDesktop());
  ipcMain.handle('cloudcli-desktop:restart-and-repair-local', async () => openLocalInDesktop({ repair: true }));
  ipcMain.handle('cloudcli-desktop:open-local-web-ui', async () => openLocalWebUi());
  ipcMain.handle('cloudcli-desktop:reload-active-tab', async () => desktopWindow.reloadActiveTab());
  ipcMain.handle('cloudcli-desktop:show-environment-picker', async () => showEnvironmentPicker());
  ipcMain.handle('cloudcli-desktop:show-launcher', async () => {
    await desktopWindow.showLauncher();
    return getDesktopState();
  });
  ipcMain.handle('cloudcli-desktop:update-desktop-notifications', async (_event, settings) => {
    await desktopNotifications?.saveSettings(settings);
    return getDesktopState();
  });
  ipcMain.handle('cloudcli-desktop:show-desktop-settings', async () => desktopWindow.showDesktopSettings());
  ipcMain.handle('cloudcli-desktop:show-local-settings', async () => desktopWindow.showLocalSettings());
  ipcMain.handle('cloudcli-desktop:close-settings-window', async () => {
    desktopWindow.closeSettingsWindow();
    return getDesktopState();
  });
  ipcMain.handle('cloudcli-desktop:update-setting', async (_event, key, value) => updateDesktopSetting(key, value));
  ipcMain.handle('cloudcli-desktop:configure-lan-access', async (event, options) => {
    if (!isTrustedDesktopChrome(event.senderFrame?.url)) {
      throw new Error('LAN configuration is unavailable for this page.');
    }
    const result = await localServer.configureLanAccess(session.defaultSession, options);
    syncDesktopState();
    if (localServer.getLocalServerUrl()) {
      await openLocalInDesktop();
    }
    return { ...getDesktopState(), lanAccessResult: result };
  });

  if (CLOUD_ENABLED) {
    ipcMain.handle('cloudcli-desktop:connect-cloud', async () => ({
      ...getDesktopState(),
      connectUrl: await connectCloudAccount(),
    }));
    ipcMain.handle('cloudcli-desktop:open-cloud-dashboard', async () => openCloudDashboard());
    ipcMain.handle('cloudcli-desktop:run-active-environment-action', async (_event, action) => runActiveEnvironmentAction(action));
    ipcMain.handle('cloudcli-desktop:open-environment', async (_event, environmentId) => {
      const environment = cloud.findEnvironment(environmentId);
      if (!environment) throw new Error('Environment not found. Refresh and try again.');
      return openEnvironmentInDesktop(environment);
    });
    ipcMain.handle('cloudcli-desktop:refresh-environments', async () => {
      await refreshCloudEnvironments({ showErrors: true });
      return getDesktopState();
    });
    ipcMain.handle('cloudcli-desktop:disconnect-cloud', async () => clearCloudAccount());
    ipcMain.handle('cloudcli-desktop:show-active-environment-actions-menu', async () => desktopWindow.showActiveEnvironmentActionsMenu());
    ipcMain.handle('cloudcli-desktop:show-environment-actions-menu', async (_event, environmentId) => desktopWindow.showEnvironmentActionsMenu(environmentId));
  }
}

function registerAppEvents() {
  if (CLOUD_ENABLED) {
    app.on('open-url', (event, url) => {
      void diagnostics?.record('app.open-url', { url });
      event.preventDefault();
      void handleDeepLink(url);
    });
  }

  app.on('activate', () => {
    void diagnostics?.record('app.activate');
    if (BrowserWindow.getAllWindows().length === 0) {
      if (desktopWindow) {
        void desktopWindow.createWindow();
      } else {
        void createDesktopWindow();
      }
      return;
    }

    const window = desktopWindow?.getMainWindow();
    if (window) {
      window.show();
      window.focus();
    }
  });

  app.on('before-quit', () => {
    void diagnostics?.record('app.before-quit');
    desktopNotifications?.stop();
    desktopUpdater?.stop();
  });

  app.on('before-quit', (event) => {
    if (isQuitting || !localServer?.hasOwnedServer()) return;
    if (localServer.getSettings().keepLocalServerRunning) {
      localServer.detachOwnedServer();
      return;
    }

    event.preventDefault();
    isQuitting = true;
    void localServer.shutdownOwnedServer().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    void diagnostics?.record('app.window-all-closed');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

async function createDesktopWindow() {
  desktopWindow = new DesktopWindowManager({
    appName: APP_NAME,
    getWindowIconPath,
    getLauncherPath,
    getPreloadPath,
    openExternalUrl,
    getDesktopState,
    getDisplayTargetName,
    getRemoteEnvironmentMenuItems,
    getCloudState,
    getLocalState,
    onDiagnostic: (event, details) => diagnostics?.record(event, details),
    tabs,
    actions: {
      copyDiagnostics,
      copyText: (text) => clipboard.writeText(text),
      clearCloudAccount,
      connectCloudAccount,
      getActiveTarget: () => activeTarget,
      getEnvironmentUrl: (environment) => cloud.getEnvironmentUrl(environment),
      openEnvironmentInBrowser,
      openEnvironmentInDesktop,
      openEnvironmentInIde,
      openEnvironmentInSsh,
      openLocalInDesktop,
      openLocalWebUi,
      openCloudDashboard,
      refreshCloudEnvironments: () => refreshCloudEnvironments({ showErrors: true }),
      setActiveTarget,
      showEnvironmentPicker,
      showError,
      startEnvironment,
      stopEnvironment,
      updateDesktopSetting,
      copyLocalWebUrl,
      openNotificationTarget,
    },
  });

  desktopWindow.createTray();
  desktopWindow.configurePermissions();
  await desktopWindow.createWindow();
}

function registerSingleInstance() {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
    return false;
  }

  app.on('second-instance', (_event, argv) => {
    const deepLink = CLOUD_ENABLED ? argv.find((arg) => arg.startsWith(`${CALLBACK_PROTOCOL}://`)) : null;
    if (deepLink) {
      void handleDeepLink(deepLink);
    }

    const window = desktopWindow?.getMainWindow();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });

  return true;
}

async function bootstrap() {
  app.name = APP_NAME;
  app.setName(APP_NAME);
  process.title = APP_NAME;

  await app.whenReady();
  diagnostics = new DesktopDiagnostics({ directory: getDiagnosticsDirectory() });
  buildIdentity = readBuildIdentity();
  await diagnostics.record('app.bootstrap-start', {
    version: buildIdentity.version,
    buildId: buildIdentity.buildId,
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
  });
  process.on('uncaughtExceptionMonitor', (error) => {
    void diagnostics?.record('process.uncaught-exception', { message: error.message, stack: error.stack });
  });
  process.on('unhandledRejection', (reason) => {
    void diagnostics?.record('process.unhandled-rejection', { reason });
  });
  app.on('child-process-gone', (_event, details) => {
    void diagnostics?.record('app.child-process-gone', details);
  });
  app.setName(APP_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: 'CloudCLI',
  });

  localServer = new LocalServerController({
    appRoot: getAppRoot(),
    resourcesRoot: app.isPackaged ? process.resourcesPath : getAppRoot(),
    settingsPath: getSettingsPath(),
    isPackaged: app.isPackaged,
    buildIdentity,
    onChange: syncDesktopState,
    onLog: (line) => diagnostics?.record('local-server.log', { line }),
  });
  cloud = CLOUD_ENABLED
    ? new CloudController({
      storePath: getStorePath(),
      controlPlaneUrl: CLOUDCLI_CONTROL_PLANE_URL,
      callbackUrl: CALLBACK_URL,
      onChange: syncDesktopState,
    })
    : createDisabledCloudController();
  desktopNotifications = new DesktopNotificationsController({
    settingsPath: getDesktopNotificationsSettingsPath(),
    appVersion: app.getVersion(),
    appName: APP_NAME,
    getDeviceId: () => cloud.getAccount()?.deviceId || '',
    getAccountEmail: () => cloud.getAccount()?.email || null,
    getRunningEnvironmentUrls,
    getApiKey: () => cloud.getAccount()?.apiKey || '',
    getAuthToken: getEnvironmentAuthToken,
    getIconPath: getWindowIconPath,
    openNotificationTarget,
    onChange: syncDesktopState,
  });
  voiceSecureStorage = createVoiceSecureStorage({
    storePath: getVoiceSecureStoragePath(),
    safeStorage,
  });

  let electronAutoUpdater = null;
  if (app.isPackaged) {
    const updaterModule = await import('electron-updater');
    electronAutoUpdater = updaterModule.autoUpdater || updaterModule.default?.autoUpdater;
    if (!electronAutoUpdater) {
      throw new Error('The packaged desktop updater could not be loaded.');
    }
  }
  desktopUpdater = new DesktopUpdaterController({
    updater: electronAutoUpdater,
    isPackaged: app.isPackaged,
    currentVersion: buildIdentity.version,
    buildId: buildIdentity.buildId,
    releasesUrl: `${productConfig.repositoryUrl}/releases`,
    beforeInstall: createDesktopInstallPreparation({
      hasOwnedServer: () => localServer.hasOwnedServer(),
      notificationsEnabled: () => desktopNotifications?.getState().enabled === true,
      stopNotifications: () => desktopNotifications?.stop(),
      shutdownOwnedServer: () => localServer.shutdownOwnedServer(),
      restoreWorkspace: () => openLocalInDesktop(),
      restoreNotifications: () => desktopNotifications?.sync(),
      onDiagnostic: (event, details) => diagnostics?.record(event, details),
    }),
    onStateChange: broadcastDesktopUpdaterState,
    onDiagnostic: (event, details) => diagnostics?.record(event, details),
  });

  await localServer.loadDesktopSettings();
  if (CLOUD_ENABLED) await cloud.loadCloudAccount();
  await desktopNotifications.loadSettings();

  registerProtocolHandler();
  registerIpcHandlers();
  registerAppEvents();
  await createDesktopWindow();
  desktopUpdater.start();
  await diagnostics.record('app.bootstrap-ready');
  if (CLOUD_ENABLED) void refreshCloudEnvironments({ showErrors: false });
}

if (registerSingleInstance()) {
  bootstrap().catch(async (error) => {
    await diagnostics?.record('app.bootstrap-failed', { message: error?.message || String(error), stack: error?.stack });
    await showError('CloudCLI failed to start', error);
    app.quit();
  });
}
