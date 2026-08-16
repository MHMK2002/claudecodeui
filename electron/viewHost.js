import { BrowserView } from 'electron';

const TARGET_LOAD_TIMEOUT_MS = 20000;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPlaceholderHtml(title, message, logs = []) {
  const logHtml = logs.length
    ? `<pre>${logs.map(escapeHtml).join('\n')}</pre>`
    : '<pre>Waiting for process output...</pre>';
  return [
    '<!doctype html><meta charset="utf-8">',
    '<style>',
    'html,body{margin:0;height:100%;color-scheme:dark;background:Canvas;color:CanvasText;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    'body{padding:28px;overflow:hidden}',
    '.shell{height:100%;display:flex;flex-direction:column;gap:16px}',
    '.box{display:flex;align-items:center;gap:10px;color:#d4d4d4;flex:0 0 auto}',
    '.dot{width:8px;height:8px;border-radius:50%;background:#0b60ea;box-shadow:0 0 0 6px rgba(11,96,234,.15)}',
    'pre{margin:0;flex:1;overflow:auto;border:1px solid #262626;border-radius:10px;background:#050505;color:#d4d4d4;padding:14px;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre-wrap;user-select:text}',
    '</style>',
    '<div class="shell">',
    `<div class="box"><span class="dot"></span><span>${escapeHtml(message || `Opening ${title}...`)}</span></div>`,
    logHtml,
    '</div>',
  ].join('');
}

const LOCAL_STARTUP_STEPS = [
  { id: 'starting-local-server', label: 'Starting local server' },
  { id: 'checking-compatibility', label: 'Checking compatibility' },
  { id: 'opening-workspace', label: 'Opening workspace' },
];

function buildLocalStartupHtml(title, stage, logs = []) {
  const activeIndex = Math.max(
    0,
    LOCAL_STARTUP_STEPS.findIndex((step) => step.id === stage),
  );
  const steps = LOCAL_STARTUP_STEPS.map((step, index) => {
    const state = index < activeIndex ? 'complete' : index === activeIndex ? 'current' : 'pending';
    const status = state === 'complete' ? 'Complete' : state === 'current' ? 'In progress' : 'Waiting';
    return `<li class="${state}"${state === 'current' ? ' aria-current="step"' : ''}>`
      + `<span class="marker" aria-hidden="true">${state === 'complete' ? '✓' : index + 1}</span>`
      + `<span class="step-copy"><strong>${escapeHtml(step.label)}</strong><small>${status}</small></span>`
      + '</li>';
  }).join('');
  const logHtml = logs.length
    ? `<pre>${logs.map(escapeHtml).join('\n')}</pre>`
    : '<pre>Waiting for process output...</pre>';
  return [
    '<!doctype html><meta charset="utf-8">',
    '<style>',
    'html,body{margin:0;height:100%;background:#0a0a0a;color:#fafafa;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    'body{padding:28px;overflow:hidden}',
    '.shell{height:100%;display:flex;flex-direction:column;gap:18px}',
    'h1{margin:0;font-size:18px;line-height:1.3}',
    '.stages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0;padding:0;list-style:none}',
    '.stages li{display:flex;align-items:center;gap:10px;border:1px solid GrayText;border-radius:10px;padding:12px;color:GrayText}',
    '.stages li.current{border-color:Highlight;color:CanvasText;background:ButtonFace}',
    '.stages li.complete{color:CanvasText}',
    '.marker{display:grid;width:26px;height:26px;flex:0 0 auto;place-items:center;border-radius:999px;background:ButtonFace;font-size:12px;font-weight:700}',
    '.current .marker{background:Highlight;color:HighlightText}',
    '.complete .marker{background:Mark;color:MarkText}',
    '.step-copy{min-width:0;display:flex;flex-direction:column;gap:2px}',
    '.step-copy strong{font-size:13px}',
    '.step-copy small{font-size:11px;color:GrayText}',
    'pre{margin:0;flex:1;overflow:auto;border:1px solid GrayText;border-radius:10px;background:Canvas;color:CanvasText;padding:14px;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre-wrap;user-select:text}',
    '@media(max-width:640px){body{padding:16px}.stages{grid-template-columns:1fr}.stages li{padding:10px}}',
    '</style>',
    '<main class="shell">',
    `<h1 role="status" aria-live="polite">Opening ${escapeHtml(title)}</h1>`,
    `<ol class="stages" aria-label="Workspace startup progress">${steps}</ol>`,
    logHtml,
    '</main>',
  ].join('');
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function loadUrlWithTimeout(webContents, url, timeoutMs = TARGET_LOAD_TIMEOUT_MS) {
  let timedOut = false;
  let timeout = null;
  const loadPromise = webContents.loadURL(url);
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      try {
        webContents.stop();
      } catch {
        // Ignore teardown races while reporting the original timeout.
      }
      reject(new Error(`Timed out loading ${url} after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
  });

  try {
    await Promise.race([loadPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      loadPromise.catch(() => {});
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class ViewHost {
  constructor({ appName, getMainWindow, getContentViewBounds, getPreloadPath, openExternalUrl, showError, onDiagnostic }) {
    this.appName = appName;
    this.getMainWindow = getMainWindow;
    this.getContentViewBounds = getContentViewBounds;
    this.getPreloadPath = getPreloadPath;
    this.openExternalUrl = openExternalUrl;
    this.showError = showError;
    this.onDiagnostic = onDiagnostic;
    this.activeContentView = null;
    this.tabViews = new Map();
  }

  configureChildWebContents(webContents) {
    if (webContents.__cloudcliDiagnosticsConfigured) return;
    webContents.__cloudcliDiagnosticsConfigured = true;
    const record = (event, details = {}) => this.onDiagnostic?.(`web-contents.${event}`, {
      id: webContents.id,
      url: webContents.isDestroyed() ? null : webContents.getURL(),
      ...details,
    });
    webContents.setWindowOpenHandler(({ url }) => {
      record('window-open-denied', { requestedUrl: url });
      void this.openExternalUrl(url).catch((error) => this.showError('Could not open external link', error));
      return { action: 'deny' };
    });
    webContents.on('did-start-loading', () => record('did-start-loading'));
    webContents.on('did-finish-load', () => record('did-finish-load'));
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      record('did-fail-load', { errorCode, errorDescription, validatedUrl, isMainFrame });
    });
    webContents.on('render-process-gone', (_event, details) => record('render-process-gone', details));
    webContents.on('unresponsive', () => record('unresponsive'));
    webContents.on('responsive', () => record('responsive'));
    webContents.on('console-message', (_event, levelOrDetails, message, line, sourceId) => {
      const details = levelOrDetails && typeof levelOrDetails === 'object'
        ? levelOrDetails
        : { level: levelOrDetails, message, lineNumber: line, sourceId };
      const level = details.level;
      if (typeof level === 'number' ? level < 2 : !/warn|error/i.test(String(level))) return;
      record('console', details);
    });
  }

  detachAll() {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      for (const view of mainWindow.getBrowserViews()) {
        mainWindow.removeBrowserView(view);
      }
    } catch {
      // BrowserViews may already be gone during BrowserWindow teardown.
    }
    this.activeContentView = null;
  }

  detachActiveView() {
    const mainWindow = this.getMainWindow();
    const view = this.activeContentView;
    if (!mainWindow || mainWindow.isDestroyed() || !view) return false;
    try {
      if (mainWindow.getBrowserViews().includes(view)) {
        mainWindow.removeBrowserView(view);
      }
    } catch {
      return false;
    }
    this.activeContentView = null;
    return true;
  }

  getActiveView() {
    const view = this.activeContentView;
    if (!view || view.webContents.isDestroyed()) return null;
    return view;
  }

  openActiveViewDevTools() {
    const view = this.getActiveView();
    if (!view) return false;
    view.webContents.openDevTools({ mode: 'detach' });
    return true;
  }

  reloadActiveView() {
    const view = this.getActiveView();
    if (!view) return false;
    view.webContents.reloadIgnoringCache();
    return true;
  }

  async readLocalStorageValueForOrigin(originUrl, key) {
    let targetOrigin;
    try {
      targetOrigin = new URL(originUrl).origin;
    } catch {
      return null;
    }

    for (const view of this.tabViews.values()) {
      if (!view || view.webContents.isDestroyed()) continue;
      let viewOrigin;
      try {
        viewOrigin = new URL(view.webContents.getURL()).origin;
      } catch {
        continue;
      }
      if (viewOrigin !== targetOrigin) continue;

      try {
        const value = await view.webContents.executeJavaScript(
          `window.localStorage.getItem(${JSON.stringify(key)})`,
          true
        );
        return typeof value === 'string' && value ? value : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  getTabViewDiagnostics() {
    const mainWindow = this.getMainWindow();
    const attachedViews = new Set();
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        for (const view of mainWindow.getBrowserViews()) {
          attachedViews.add(view);
        }
      } catch {
        // Ignore teardown races while gathering best-effort diagnostics.
      }
    }

    return Array.from(this.tabViews.entries()).map(([tabId, view]) => {
      const { webContents } = view;
      const destroyed = webContents.isDestroyed();
      return {
        tabId,
        webContentsId: destroyed ? null : webContents.id,
        url: destroyed ? null : webContents.getURL(),
        title: destroyed ? null : webContents.getTitle(),
        osProcessId: destroyed || typeof webContents.getOSProcessId !== 'function' ? null : webContents.getOSProcessId(),
        processId: destroyed || typeof webContents.getProcessId !== 'function' ? null : webContents.getProcessId(),
        attached: attachedViews.has(view),
        active: this.activeContentView === view,
        destroyed,
      };
    });
  }

  getOrCreateTabView(tabId) {
    let view = this.tabViews.get(tabId);
    if (view) return view;

    view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: this.getPreloadPath(),
      },
    });
    this.configureChildWebContents(view.webContents);
    this.tabViews.set(tabId, view);
    return view;
  }

  attach(view) {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (this.activeContentView && this.activeContentView !== view) {
      this.detachAll();
    }
    this.activeContentView = view;
    try {
      if (!mainWindow.getBrowserViews().includes(view)) {
        mainWindow.addBrowserView(view);
      }
    } catch {
      return;
    }
    view.setBounds(this.getContentViewBounds());
    view.setAutoResize({ width: true, height: true });
  }

  resizeActiveView() {
    if (this.activeContentView) {
      this.activeContentView.setBounds(this.getContentViewBounds());
    }
  }

  async showTabPlaceholder(tabId, target, message) {
    const view = this.getOrCreateTabView(tabId);
    this.attach(view);
    const html = buildPlaceholderHtml(target.name || this.appName, message);
    await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    view.__cloudcliStartupHtml = html;
    view.__cloudcliLoadedUrl = null;
  }

  async showLocalStartupTarget(tabId, target, logs, stage = 'starting-local-server') {
    const view = this.getOrCreateTabView(tabId);
    if (view.__cloudcliLoadingUrl) return;
    this.attach(view);
    const html = buildLocalStartupHtml(target.name || this.appName, stage, logs);
    if (view.__cloudcliStartupHtml === html) return;
    await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    view.__cloudcliStartupHtml = html;
    view.__cloudcliLoadedUrl = null;
  }

  async showContentTarget(tabId, target) {
    const loadUrl = target.loadUrl || target.url;
    if (!isHttpUrl(loadUrl)) {
      throw new Error(`Refusing to load unsupported app URL: ${loadUrl}`);
    }
    const view = this.getOrCreateTabView(tabId);
    this.attach(view);
    if (target.forceLoad || view.__cloudcliLoadedUrl !== target.url) {
      view.__cloudcliLoadingUrl = loadUrl;
      try {
        await loadUrlWithTimeout(view.webContents, loadUrl);
        view.__cloudcliLoadedUrl = target.url;
        view.__cloudcliStartupHtml = null;
        delete target.loadUrl;
        delete target.forceLoad;
      } finally {
        if (view.__cloudcliLoadingUrl === loadUrl) {
          view.__cloudcliLoadingUrl = null;
        }
      }
    }
    return view.webContents.getURL();
  }

  reloadTab(tabId) {
    const view = this.tabViews.get(tabId);
    if (!view || view.webContents.isDestroyed()) return false;
    view.webContents.reloadIgnoringCache();
    return true;
  }

  async navigateActiveView(url) {
    const view = this.getActiveView();
    if (!view) return false;
    await loadUrlWithTimeout(view.webContents, url);
    view.__cloudcliLoadedUrl = url;
    view.__cloudcliStartupHtml = null;
    return true;
  }

  destroyTabView(tabId) {
    const view = this.tabViews.get(tabId);
    if (!view) return;
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        if (mainWindow.getBrowserViews().includes(view)) {
          mainWindow.removeBrowserView(view);
        }
      } catch {
        // Ignore teardown races; Electron owns final destruction during quit.
      }
    }
    if (this.activeContentView === view) {
      this.activeContentView = null;
    }
    try {
      if (!view.webContents.isDestroyed()) {
        view.webContents.destroy();
      }
    } catch {
      // The view may already be destroyed by its parent BrowserWindow.
    }
    this.tabViews.delete(tabId);
  }

  clear() {
    this.tabViews.clear();
    this.activeContentView = null;
  }
}
