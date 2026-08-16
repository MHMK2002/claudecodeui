const { contextBridge, ipcRenderer } = require('electron');
const productConfig = require('../shared/product-config.json');
const CLOUD_ENABLED = productConfig?.features?.cloud === true;

function isCloudCliAppOrigin(location) {
  if (location.protocol === 'file:') return true;

  if (location.protocol === 'http:') {
    return location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  }

  return CLOUD_ENABLED && location.protocol === 'https:' && (
    location.hostname === 'cloudcli.ai' || location.hostname.endsWith('.cloudcli.ai')
  );
}

function onDesktopStateUpdated(callback) {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on('cloudcli-desktop:state-updated', listener);
  return () => {
    ipcRenderer.removeListener('cloudcli-desktop:state-updated', listener);
  };
}

function onDesktopUpdaterStateChanged(callback) {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on('cloudcli-desktop:updater-state-changed', listener);
  return () => {
    ipcRenderer.removeListener('cloudcli-desktop:updater-state-changed', listener);
  };
}

function isLocalCloudCliOrigin(location) {
  return location.protocol === 'http:'
    && (location.hostname === '127.0.0.1' || location.hostname === 'localhost');
}

if (isLocalCloudCliOrigin(window.location)) {
  contextBridge.exposeInMainWorld('cloudcliDesktopLocalSession', {
    renew: () => ipcRenderer.invoke('cloudcli-desktop:renew-local-session'),
  });
  contextBridge.exposeInMainWorld('cloudcliDesktopPdf', {
    exportPdf: (payload) => ipcRenderer.invoke('cloudcli-desktop:export-pdf', payload),
  });
  contextBridge.exposeInMainWorld('cloudcliDesktopVoiceSecrets', {
    get: () => ipcRenderer.invoke('cloudcli-desktop:get-voice-secrets'),
    set: (patch) => ipcRenderer.invoke('cloudcli-desktop:set-voice-secrets', patch),
  });
  contextBridge.exposeInMainWorld('cloudcliDesktopUpdater', {
    getState: () => ipcRenderer.invoke('cloudcli-desktop:updater-get-state'),
    check: () => ipcRenderer.invoke('cloudcli-desktop:updater-check'),
    restartAndInstall: () => ipcRenderer.invoke('cloudcli-desktop:updater-restart-and-install'),
    onStateChanged: onDesktopUpdaterStateChanged,
  });
}

if (isCloudCliAppOrigin(window.location)) {
  contextBridge.exposeInMainWorld('cloudcliDesktopNotifications', {
    getState: () => ipcRenderer.invoke('cloudcli-desktop:get-state'),
    update: (settings) => ipcRenderer.invoke('cloudcli-desktop:update-desktop-notifications', settings),
    onStateUpdated: onDesktopStateUpdated,
  });
}

if (window.location.protocol === 'file:') {
  const desktopApi = {
    copyDiagnostics: () => ipcRenderer.invoke('cloudcli-desktop:copy-diagnostics'),
    configureLanAccess: (options) => ipcRenderer.invoke('cloudcli-desktop:configure-lan-access', options),
    copyLocalWebUrl: () => ipcRenderer.invoke('cloudcli-desktop:copy-local-web-url'),
    getState: () => ipcRenderer.invoke('cloudcli-desktop:get-state'),
    openLocal: () => ipcRenderer.invoke('cloudcli-desktop:open-local'),
    restartAndRepairLocal: () => ipcRenderer.invoke('cloudcli-desktop:restart-and-repair-local'),
    openLocalWebUi: () => ipcRenderer.invoke('cloudcli-desktop:open-local-web-ui'),
    refreshActiveTab: () => ipcRenderer.invoke('cloudcli-desktop:reload-active-tab'),
    showEnvironmentPicker: () => ipcRenderer.invoke('cloudcli-desktop:show-environment-picker'),
    showLauncher: () => ipcRenderer.invoke('cloudcli-desktop:show-launcher'),
    showLocalSettings: () => ipcRenderer.invoke('cloudcli-desktop:show-local-settings'),
    showDesktopSettings: () => ipcRenderer.invoke('cloudcli-desktop:show-desktop-settings'),
    closeSettingsWindow: () => ipcRenderer.invoke('cloudcli-desktop:close-settings-window'),
    updateSetting: (key, value) => ipcRenderer.invoke('cloudcli-desktop:update-setting', key, value),
    onStateUpdated: onDesktopStateUpdated,
    onLauncherCommand: (callback) => {
      ipcRenderer.on('cloudcli-desktop:launcher-command', (_event, command) => callback(command));
    },
  };

  if (CLOUD_ENABLED) {
    Object.assign(desktopApi, {
      connectCloud: () => ipcRenderer.invoke('cloudcli-desktop:connect-cloud'),
      disconnectCloud: () => ipcRenderer.invoke('cloudcli-desktop:disconnect-cloud'),
      openCloudDashboard: () => ipcRenderer.invoke('cloudcli-desktop:open-cloud-dashboard'),
      openEnvironment: (environmentId) => ipcRenderer.invoke('cloudcli-desktop:open-environment', environmentId),
      runActiveEnvironmentAction: (action) => ipcRenderer.invoke('cloudcli-desktop:run-active-environment-action', action),
      refreshEnvironments: () => ipcRenderer.invoke('cloudcli-desktop:refresh-environments'),
      showActiveEnvironmentActionsMenu: () => ipcRenderer.invoke('cloudcli-desktop:show-active-environment-actions-menu'),
      showEnvironmentActionsMenu: (environmentId) => ipcRenderer.invoke('cloudcli-desktop:show-environment-actions-menu', environmentId),
    });
  }

  contextBridge.exposeInMainWorld('cloudcliDesktop', desktopApi);
}
