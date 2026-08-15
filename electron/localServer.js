import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { redactDiagnosticValue } from './diagnostics.js';
import { ServerInstaller } from './serverInstaller.js';

const DEFAULT_PORT = 3001;
const HOST = '127.0.0.1';
const DISPLAY_HOST = 'localhost';
const HEALTH_TIMEOUT_MS = 1000;
const SERVER_START_TIMEOUT_MS = 30000;
const MAX_SERVER_START_ATTEMPTS = 3;
const MAX_STARTUP_LOG_LINES = 300;
const SERVER_MARKER_PATH = path.join(os.homedir(), '.cloudcli', 'local-server.json');
const LOCAL_SERVER_URL_ENV_KEYS = [
  'CLOUDCLI_DESKTOP_LOCAL_SERVER_URL',
  'CLOUDCLI_LOCAL_SERVER_URL',
  'ELECTRON_LOCAL_SERVER_URL',
];
const LOCAL_SERVER_PORT_ENV_KEYS = [
  'CLOUDCLI_DESKTOP_LOCAL_SERVER_PORT',
  'CLOUDCLI_SERVER_PORT',
  'SERVER_PORT',
  'PORT',
];

function requestJson(url, timeoutMs = HEALTH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            json: JSON.parse(body),
          });
        } catch {
          resolve({ ok: false, json: null });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, json: null });
    });
    req.on('error', () => resolve({ ok: false, json: null }));
  });
}

async function getCloudCliHealth(baseUrl) {
  const response = await requestJson(`${baseUrl}/health`);
  return response.ok
    && response.json?.status === 'ok'
    && typeof response.json?.installMode === 'string'
    ? response.json
    : null;
}

async function isCloudCliServer(baseUrl, expectedBuildId = null) {
  const health = await getCloudCliHealth(baseUrl);
  return Boolean(health && (!expectedBuildId || health.buildId === expectedBuildId));
}

function isPortListening(port, host = HOST) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function isPortAvailable(port, host = HOST) {
  // Binding 127.0.0.1 can succeed alongside an existing 0.0.0.0 listener on
  // some platforms. A real loopback connection catches that ambiguous case.
  if (await isPortListening(port, HOST)) return false;
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function getFreePort(host = HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : DEFAULT_PORT;
      server.close(() => resolve(port));
    });
    server.listen(0, host);
  });
}

async function chooseServerPort(host, excludedPorts = new Set()) {
  if (!excludedPorts.has(DEFAULT_PORT) && await isPortAvailable(DEFAULT_PORT, host)) {
    return DEFAULT_PORT;
  }

  let port = await getFreePort(host);
  while (excludedPorts.has(port)) {
    port = await getFreePort(host);
  }
  return port;
}

function getDesktopPath() {
  const currentPath = process.env.PATH || '';
  const commonPaths = process.platform === 'win32'
    ? []
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

  return [...commonPaths, currentPath].filter(Boolean).join(path.delimiter);
}

function getNodeRuntime(usePackagedElectronRuntime) {
  if (process.env.ELECTRON_NODE_PATH) {
    return { command: process.env.ELECTRON_NODE_PATH, env: {}, label: 'ELECTRON_NODE_PATH' };
  }

  if (usePackagedElectronRuntime && process.versions.electron) {
    return {
      command: process.execPath,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      label: `Electron ${process.versions.electron} Node ${process.versions.node}`,
    };
  }

  if (process.env.npm_node_execpath) {
    return { command: process.env.npm_node_execpath, env: {}, label: 'npm_node_execpath' };
  }

  return { command: 'node', env: {}, label: 'PATH node' };
}

function stripTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function addCandidateUrl(urls, rawUrl) {
  if (!rawUrl) return;
  try {
    const parsed = new URL(String(rawUrl));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    parsed.hash = '';
    parsed.search = '';
    const normalized = stripTrailingSlash(parsed.toString());
    if (!urls.includes(normalized)) urls.push(normalized);
  } catch {
    // Ignore invalid user-provided discovery values.
  }
}

function addCandidatePort(urls, rawPort) {
  const port = Number.parseInt(String(rawPort || ''), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return;
  addCandidateUrl(urls, `http://${HOST}:${port}`);
}

function getPortFromUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.port) return Number.parseInt(parsed.port, 10);
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return null;
  }
}

function getDisplayUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.hostname === HOST) {
      parsed.hostname = DISPLAY_HOST;
    }
    return stripTrailingSlash(parsed.toString());
  } catch {
    return baseUrl;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readServerBundleConfig(appRoot) {
  try {
    const raw = await fs.readFile(path.join(appRoot, 'electron', 'server-bundle-config.json'), 'utf8');
    const config = JSON.parse(raw);
    return {
      releaseTag: typeof config.releaseTag === 'string' && config.releaseTag.trim()
        ? config.releaseTag.trim()
        : '',
    };
  } catch {
    return { releaseTag: '' };
  }
}

function getServerCwd(appRoot, serverEntry) {
  const normalizedEntry = path.resolve(serverEntry);
  const bundledEntry = path.resolve(appRoot, 'dist-server', 'server', 'index.js');
  if (normalizedEntry === bundledEntry) {
    return appRoot;
  }

  // Installed server entries are laid out as <root>/dist-server/server/index.js.
  return path.resolve(path.dirname(normalizedEntry), '..', '..');
}

async function readServerMarkerUrl() {
  try {
    const raw = await fs.readFile(SERVER_MARKER_PATH, 'utf8');
    const marker = JSON.parse(raw);
    return marker.url || (marker.port ? `http://${marker.host || HOST}:${marker.port}` : null);
  } catch {
    return null;
  }
}

async function getExistingServerCandidateUrls(defaultUrl) {
  const urls = [];

  for (const key of LOCAL_SERVER_URL_ENV_KEYS) {
    addCandidateUrl(urls, process.env[key]);
  }

  addCandidateUrl(urls, await readServerMarkerUrl());

  for (const key of LOCAL_SERVER_PORT_ENV_KEYS) {
    addCandidatePort(urls, process.env[key]);
  }

  addCandidateUrl(urls, defaultUrl);
  return urls;
}

async function waitForCloudCliServer(baseUrl, timeoutMs, expected = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const health = await getCloudCliHealth(baseUrl);
    if (health
      && (!expected.buildId || health.buildId === expected.buildId)
      && (!expected.launchNonce || health.desktopLaunchNonce === expected.launchNonce)) {
      return health;
    }
    if (expected.child && expected.child.exitCode !== null) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

export class LocalServerController {
  constructor({ appRoot, resourcesRoot = appRoot, settingsPath, isPackaged = false, appVersion, buildId = null, onChange, onLog }) {
    this.appRoot = appRoot;
    this.resourcesRoot = resourcesRoot;
    this.settingsPath = settingsPath;
    this.isPackaged = isPackaged;
    this.appVersion = appVersion;
    this.buildId = buildId;
    this.onChange = onChange;
    this.onLog = onLog;
    this.localServerUrl = null;
    this.localServerPort = null;
    this.ownedServerProcess = null;
    this.verifiedLocalOrigin = null;
    this.startupLogs = [];
    this.desktopSettings = {
      keepLocalServerRunning: false,
      exposeLocalServerOnNetwork: false,
      themeMode: 'system',
    };
  }

  getSettings() {
    return this.desktopSettings;
  }

  getLocalServerUrl() {
    return this.localServerUrl;
  }

  getHealthCheckUrl() {
    if (!this.localServerPort) return this.localServerUrl;
    return `http://${HOST}:${this.localServerPort}`;
  }

  getVerifiedLocalOrigin() {
    return this.verifiedLocalOrigin;
  }

  appendStartupLog(line) {
    const text = String(redactDiagnosticValue(String(line || ''))).trimEnd();
    if (!text) return;
    const timestamp = new Date().toLocaleTimeString();
    this.startupLogs.push(`[${timestamp}] ${text}`);
    if (this.startupLogs.length > MAX_STARTUP_LOG_LINES) {
      this.startupLogs.splice(0, this.startupLogs.length - MAX_STARTUP_LOG_LINES);
    }
    this.onChange?.();
    this.onLog?.(text);
  }

  getStartupLogs() {
    return [...this.startupLogs];
  }

  getPendingTarget() {
    return {
      kind: 'local',
      name: 'Local CloudCLI',
      url: this.localServerUrl || `http://${DISPLAY_HOST}:${this.localServerPort || DEFAULT_PORT}`,
    };
  }

  getLanAddress() {
    const interfaces = os.networkInterfaces();
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (entry.family === 'IPv4' && !entry.internal) {
          return entry.address;
        }
      }
    }
    return null;
  }

  getShareableWebUrl() {
    if (!this.localServerUrl || !this.localServerPort) return null;
    if (this.desktopSettings.exposeLocalServerOnNetwork) {
      const lanAddress = this.getLanAddress();
      if (lanAddress) {
        return `http://${lanAddress}:${this.localServerPort}`;
      }
    }
    return this.getLocalServerUrl();
  }

  getServerBindHost() {
    return this.desktopSettings.exposeLocalServerOnNetwork ? '0.0.0.0' : HOST;
  }

  async loadDesktopSettings() {
    try {
      const raw = await fs.readFile(this.settingsPath, 'utf8');
      const stored = JSON.parse(raw);
      this.desktopSettings = {
        keepLocalServerRunning: Boolean(stored.keepLocalServerRunning),
        exposeLocalServerOnNetwork: Boolean(stored.exposeLocalServerOnNetwork),
        themeMode: stored.themeMode === 'light' || stored.themeMode === 'dark' ? stored.themeMode : 'system',
      };
    } catch {
      this.desktopSettings = {
        keepLocalServerRunning: false,
        exposeLocalServerOnNetwork: false,
        themeMode: 'system',
      };
    }
  }

  async saveDesktopSettings(nextSettings = this.desktopSettings) {
    this.desktopSettings = {
      keepLocalServerRunning: Boolean(nextSettings.keepLocalServerRunning),
      exposeLocalServerOnNetwork: Boolean(nextSettings.exposeLocalServerOnNetwork),
      themeMode: nextSettings.themeMode === 'light' || nextSettings.themeMode === 'dark' ? nextSettings.themeMode : 'system',
    };
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(this.desktopSettings, null, 2), 'utf8');
    this.onChange?.();
  }

  async updateDesktopSetting(key, value) {
    if (!Object.prototype.hasOwnProperty.call(this.desktopSettings, key)) {
      throw new Error(`Unknown desktop setting: ${key}`);
    }

    const wasExposeSetting = key === 'exposeLocalServerOnNetwork';
    const wasLocalRunning = Boolean(this.localServerUrl);
    const nextValue = key === 'themeMode' ? value : Boolean(value);
    await this.saveDesktopSettings({ ...this.desktopSettings, [key]: nextValue });

    return {
      desktopSettings: this.desktopSettings,
      requiresRestartNotice: wasExposeSetting && wasLocalRunning,
    };
  }

  /** Resolves the embedded customized server before considering a downloaded runtime. */
  async resolveServerEntry() {
    if (process.env.ELECTRON_SERVER_ENTRY) {
      return process.env.ELECTRON_SERVER_ENTRY;
    }

    const bundledEntries = [
      path.join(this.resourcesRoot, 'server-runtime', 'dist-server', 'server', 'index.js'),
      path.join(this.appRoot, 'server-runtime', 'dist-server', 'server', 'index.js'),
      path.join(this.appRoot, 'dist-server', 'server', 'index.js'),
    ].filter((entry, index, entries) => entries.indexOf(entry) === index);
    if (process.env.CLOUDCLI_USE_INSTALLED_SERVER !== '1') {
      for (const bundledEntry of bundledEntries) {
        if (await pathExists(bundledEntry)) {
          this.appendStartupLog(`Using bundled Local CloudCLI from ${bundledEntry}`);
          return bundledEntry;
        }
      }
    }

    if (!this.appVersion) {
      throw new Error('Cannot install local server: app version is unknown.');
    }
    const bundleConfig = await readServerBundleConfig(this.appRoot);
    const installer = new ServerInstaller({
      version: this.appVersion,
      bundleReleaseTag: bundleConfig.releaseTag,
      onLog: (line) => this.appendStartupLog(line),
    });
    const embeddedArchive = path.join(
      this.resourcesRoot,
      'embedded-server',
      installer.getBundleName(),
    );
    if (process.env.CLOUDCLI_USE_INSTALLED_SERVER !== '1' && await pathExists(embeddedArchive)) {
      return installer.ensureInstalledFromArchive(embeddedArchive);
    }
    return installer.ensureInstalled();
  }

  startBundledServer(port, serverEntry, launchNonce) {
    const bindHost = this.getServerBindHost();
    const runtime = getNodeRuntime(this.isPackaged);
    const serverCwd = getServerCwd(this.appRoot, serverEntry);

    const command = `${runtime.command} ${serverEntry}`;
    this.appendStartupLog(`$ ${command}`);
    this.appendStartupLog(`runtime: ${runtime.label}`);
    this.appendStartupLog(`cwd: ${serverCwd}`);
    this.appendStartupLog(`HOST=${bindHost} SERVER_PORT=${port}`);

    const child = spawn(runtime.command, [serverEntry], {
      cwd: serverCwd,
      detached: true,
      env: {
        ...process.env,
        ...runtime.env,
        HOST: bindHost,
        SERVER_PORT: String(port),
        CLOUDCLI_DESKTOP_LAUNCH_NONCE: launchNonce,
        CLOUDCLI_DISABLE_LOCAL_SERVER_MARKER: '1',
        PATH: getDesktopPath(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.ownedServerProcess = child;

    child.once('error', (error) => {
      this.appendStartupLog(`failed to start process: ${error.message}`);
      if (this.ownedServerProcess === child) this.ownedServerProcess = null;
    });

    child.stdout?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        this.appendStartupLog(line);
      }
    });

    child.stderr?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        this.appendStartupLog(`stderr: ${line}`);
      }
    });

    child.once('exit', (code, signal) => {
      this.appendStartupLog(`process exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`);
      if (this.ownedServerProcess === child) {
        console.error(`CloudCLI desktop server exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`);
        this.ownedServerProcess = null;
      }
    });
    return child;
  }

  async resolveLocalServerUrl() {
    const defaultUrl = `http://${HOST}:${DEFAULT_PORT}`;
    const defaultDisplayUrl = `http://${DISPLAY_HOST}:${DEFAULT_PORT}`;
    const devUrl = process.env.ELECTRON_DEV_URL;
    const forceOwnServer = process.env.ELECTRON_FORCE_OWN_SERVER === '1';
    const allowExistingServer = process.env.CLOUDCLI_DESKTOP_REUSE_EXISTING_SERVER === '1';

    if (devUrl) {
      const ready = await waitForCloudCliServer(defaultUrl, SERVER_START_TIMEOUT_MS, { buildId: this.buildId });
      if (!ready) {
        throw new Error(`Development backend did not become ready at ${defaultDisplayUrl}`);
      }
      this.localServerPort = DEFAULT_PORT;
      this.verifiedLocalOrigin = new URL(devUrl).origin;
      return devUrl;
    }

    if (!forceOwnServer && (!this.isPackaged || allowExistingServer)) {
      const candidateUrls = await getExistingServerCandidateUrls(defaultUrl);
      for (const candidateUrl of candidateUrls) {
        if (await isCloudCliServer(candidateUrl, this.buildId)) {
          const displayUrl = getDisplayUrl(candidateUrl);
          this.localServerPort = getPortFromUrl(candidateUrl);
          this.verifiedLocalOrigin = new URL(displayUrl).origin;
          this.appendStartupLog(`Using existing Local CloudCLI at ${displayUrl}`);
          return displayUrl;
        }
      }
    }

    const serverEntry = await this.resolveServerEntry();

    const attemptedPorts = new Set();
    for (let attempt = 1; attempt <= MAX_SERVER_START_ATTEMPTS; attempt += 1) {
      const port = await chooseServerPort(this.getServerBindHost(), attemptedPorts);
      attemptedPorts.add(port);
      const serverUrl = `http://${HOST}:${port}`;
      const displayUrl = `http://${DISPLAY_HOST}:${port}`;
      const launchNonce = crypto.randomBytes(32).toString('hex');
      this.localServerPort = port;
      const logStart = this.startupLogs.length;
      const child = this.startBundledServer(port, serverEntry, launchNonce);

      const ready = await waitForCloudCliServer(serverUrl, SERVER_START_TIMEOUT_MS, {
        buildId: this.buildId,
        launchNonce,
        child,
      });
      if (ready) {
        this.appendStartupLog(`Local CloudCLI ready at ${displayUrl}`);
        this.localServerUrl = displayUrl;
        this.verifiedLocalOrigin = new URL(displayUrl).origin;
        return displayUrl;
      }

      const attemptLogs = this.startupLogs.slice(logStart);
      const addressInUse = attemptLogs.some((line) => /EADDRINUSE|address already in use/i.test(line));
      await this.shutdownOwnedServer();
      if (addressInUse && attempt < MAX_SERVER_START_ATTEMPTS) {
        this.appendStartupLog(`Port ${port} was claimed during startup; retrying with another loopback port.`);
        continue;
      }

      const recentLogs = this.getStartupLogs().slice(-20).join('\n');
      this.localServerPort = null;
      this.verifiedLocalOrigin = null;
      throw new Error([
        `Bundled backend did not become ready at ${displayUrl}.`,
        recentLogs ? `Recent startup output:\n${recentLogs}` : 'No startup output was captured.',
      ].join('\n\n'));
    }
    throw new Error('Bundled backend could not reserve a local port.');
  }

  async ensureLocalServer() {
    if (!this.localServerUrl) {
      this.localServerUrl = await this.resolveLocalServerUrl();
    }
    return this.localServerUrl;
  }

  async getResolvedTarget() {
    await this.ensureLocalServer();
    return {
      kind: 'local',
      name: 'Local CloudCLI',
      url: this.localServerUrl,
    };
  }

  async loadLocalTarget() {
    return {
      pendingTarget: this.getPendingTarget(),
      target: await this.getResolvedTarget(),
    };
  }

  hasOwnedServer() {
    return Boolean(this.ownedServerProcess);
  }

  detachOwnedServer() {
    if (!this.ownedServerProcess) return;
    this.ownedServerProcess.unref();
    this.ownedServerProcess = null;
  }

  async shutdownOwnedServer() {
    if (!this.ownedServerProcess) return;

    const child = this.ownedServerProcess;
    this.ownedServerProcess = null;
    child.kill('SIGTERM');

    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}

export { DEFAULT_PORT, HOST };
