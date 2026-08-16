import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  assertBuildIdentity,
  buildIdentitiesMatch,
} from '../shared/buildIdentity.js';
import {
  DESKTOP_SESSION_NONCE_HEADER,
  DESKTOP_SESSION_SECRET_HEADER,
  LOCAL_SESSION_COOKIE_NAME,
  createDesktopSessionNonce,
  isDesktopSessionNonce,
} from '../shared/local-session.js';
import { RUNTIME_MODES } from '../shared/runtime-mode.js';
import { redactDiagnosticValue } from './diagnostics.js';
import { ServerInstaller } from './serverInstaller.js';

const DEFAULT_PORT = 3001;
const HOST = '127.0.0.1';
const DISPLAY_HOST = 'localhost';
const HEALTH_TIMEOUT_MS = 1000;
const SERVER_START_TIMEOUT_MS = 30000;
const SERVER_STOP_TIMEOUT_MS = 5000;
const MAX_SERVER_START_ATTEMPTS = 3;
const MAX_STARTUP_LOG_LINES = 300;
const LOCAL_STARTUP_STAGES = new Set([
  'idle',
  'starting-local-server',
  'checking-compatibility',
  'opening-workspace',
  'failed',
]);
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

function readLoopbackOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

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
            reachable: true,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            json: JSON.parse(body),
          });
        } catch {
          resolve({ reachable: true, ok: false, json: null });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ reachable: false, ok: false, json: null });
    });
    req.on('error', () => resolve({ reachable: false, ok: false, json: null }));
  });
}

async function inspectCloudCliHealth(baseUrl) {
  const response = await requestJson(`${baseUrl}/health`);
  if (!response.reachable) return { kind: 'unreachable', health: null, raw: null };
  const health = response.ok
    && response.json?.status === 'ok'
    && typeof response.json?.installMode === 'string'
    && typeof response.json?.version === 'string'
    && typeof response.json?.buildId === 'string'
    && RUNTIME_MODES.includes(response.json?.runtimeMode)
    ? response.json
    : null;
  return health
    ? { kind: 'valid', health, raw: response.json }
    : { kind: 'invalid', health: null, raw: response.json };
}

async function getCloudCliHealth(baseUrl) {
  return (await inspectCloudCliHealth(baseUrl)).health;
}

function getDesktopOwnerProof(ownerNonce) {
  return typeof ownerNonce === 'string' && ownerNonce
    ? crypto.createHash('sha256').update(ownerNonce).digest('hex')
    : null;
}

function requestDesktopShutdown(baseUrl, ownerNonce) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL('/desktop/shutdown', baseUrl);
      if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)) {
        resolve(false);
        return;
      }
    } catch {
      resolve(false);
      return;
    }
    const request = http.request(parsed, {
      method: 'POST',
      timeout: HEALTH_TIMEOUT_MS,
      headers: {
        'x-cloudcli-desktop-owner-nonce': ownerNonce,
      },
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode === 202));
    });
    request.once('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.once('error', () => resolve(false));
    request.end();
  });
}

function requestDesktopSession(baseUrl, pathname, ownerSecret, nonce, payload = null) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(pathname, baseUrl);
      if (
        parsed.protocol !== 'http:'
        || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)
      ) {
        reject(new Error('Desktop session endpoint must use a loopback HTTP origin.'));
        return;
      }
    } catch {
      reject(new Error('Desktop session endpoint is invalid.'));
      return;
    }

    const body = payload === null ? '' : JSON.stringify(payload);
    const request = http.request(parsed, {
      method: 'POST',
      timeout: HEALTH_TIMEOUT_MS * 5,
      headers: {
        Accept: 'application/json',
        [DESKTOP_SESSION_SECRET_HEADER]: ownerSecret,
        [DESKTOP_SESSION_NONCE_HEADER]: nonce,
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length < 64 * 1024) body += chunk;
      });
      response.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          // The caller reports a stable compatibility error without including
          // server HTML or other potentially sensitive response content.
        }
        resolve({
          statusCode: response.statusCode ?? 0,
          json,
          setCookie: response.headers['set-cookie'] ?? [],
        });
      });
    });
    request.once('timeout', () => request.destroy(new Error('Desktop session request timed out.')));
    request.once('error', reject);
    request.end(body);
  });
}

function parseDesktopSessionCookie(headers) {
  const rawCookie = headers.find((value) => value.startsWith(`${LOCAL_SESSION_COOKIE_NAME}=`));
  if (!rawCookie) return null;
  const parts = rawCookie.split(';').map((part) => part.trim());
  const [pair, ...attributes] = parts;
  const separatorIndex = pair.indexOf('=');
  const encodedValue = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : '';
  const normalizedAttributes = new Set(attributes.map((attribute) => attribute.toLowerCase()));
  if (
    !encodedValue
    || !normalizedAttributes.has('httponly')
    || !normalizedAttributes.has('samesite=strict')
    || !normalizedAttributes.has('path=/')
  ) {
    return null;
  }

  const maxAgeAttribute = attributes.find((attribute) => attribute.toLowerCase().startsWith('max-age='));
  const maxAgeSeconds = Number.parseInt(maxAgeAttribute?.split('=')[1] ?? '', 10);
  try {
    return {
      value: decodeURIComponent(encodedValue),
      secure: normalizedAttributes.has('secure'),
      expirationDate: Number.isFinite(maxAgeSeconds)
        ? Math.floor(Date.now() / 1000) + Math.max(0, maxAgeSeconds)
        : undefined,
    };
  } catch {
    return null;
  }
}

export class LocalServerCompatibilityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LocalServerCompatibilityError';
    this.code = 'LOCAL_SERVER_COMPATIBILITY';
    this.details = details;
  }
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

function getComparableOrigin(baseUrl) {
  const parsed = new URL(baseUrl);
  const hostname = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)
    ? 'loopback'
    : parsed.hostname;
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  return `${parsed.protocol}//${hostname}:${port}`;
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

async function readServerMarker(markerPath = SERVER_MARKER_PATH) {
  try {
    const raw = await fs.readFile(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    if (!marker || typeof marker !== 'object') return null;
    const url = marker.url || (marker.port ? `http://${marker.host || HOST}:${marker.port}` : null);
    return url ? { ...marker, url: stripTrailingSlash(String(url)) } : null;
  } catch {
    return null;
  }
}

async function getExistingServerCandidateUrls(defaultUrl, marker = null) {
  const urls = [];

  for (const key of LOCAL_SERVER_URL_ENV_KEYS) {
    addCandidateUrl(urls, process.env[key]);
  }

  addCandidateUrl(urls, marker?.url);

  for (const key of LOCAL_SERVER_PORT_ENV_KEYS) {
    addCandidatePort(urls, process.env[key]);
  }

  addCandidateUrl(urls, defaultUrl);
  return urls;
}

function isVerifiedDesktopServerMarker(marker, health, candidateUrl) {
  if (!marker || !health || marker.managedBy !== 'cloudcli-desktop') return false;
  if (!Number.isInteger(marker.pid) || marker.pid <= 1) return false;
  if (health.pid !== marker.pid) return false;
  if (typeof marker.desktopLaunchNonce !== 'string' || !marker.desktopLaunchNonce) return false;
  if (typeof marker.desktopOwnerNonce !== 'string' || !marker.desktopOwnerNonce) return false;
  if (typeof marker.desktopProcessStartedAt !== 'string' || !marker.desktopProcessStartedAt) return false;
  if (marker.desktopLaunchNonce !== health.desktopLaunchNonce) return false;
  if (getDesktopOwnerProof(marker.desktopOwnerNonce) !== health.desktopOwnerProof) return false;
  if (marker.desktopProcessStartedAt !== health.desktopProcessStartedAt) return false;
  if (marker.runtimeMode !== health.runtimeMode) return false;
  if (!buildIdentitiesMatch(marker, health)) return false;
  try {
    return getComparableOrigin(marker.url) === getComparableOrigin(candidateUrl);
  } catch {
    return false;
  }
}

function isVerifiedServerProof(proof, health, candidateUrl) {
  if (!proof || !health || !buildIdentitiesMatch(proof, health)) return false;
  if (proof.runtimeMode !== health.runtimeMode) return false;
  if (proof.kind === 'identity-only') {
    try {
      return getComparableOrigin(proof.url) === getComparableOrigin(candidateUrl);
    } catch {
      return false;
    }
  }
  return isVerifiedDesktopServerMarker(proof, health, candidateUrl);
}

async function waitForCloudCliServer(baseUrl, timeoutMs, expected = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const inspection = await inspectCloudCliHealth(baseUrl);
    const invalidResponseBelongsToChild = inspection.kind === 'invalid'
      && expected.child
      && (
        inspection.raw?.pid === expected.child.pid
        || inspection.raw?.desktopLaunchNonce === expected.launchNonce
      );
    if (invalidResponseBelongsToChild) {
      throw new LocalServerCompatibilityError(
        'Started local server returned malformed or incomplete health identity.',
      );
    }
    const health = inspection.health;
    if (health && (!expected.launchNonce || health.desktopLaunchNonce === expected.launchNonce)) {
      if (expected.identity && !buildIdentitiesMatch(health, expected.identity)) {
        throw new LocalServerCompatibilityError(
          `Started local server reported ${health.version} / ${health.buildId}, expected ${expected.identity.version} / ${expected.identity.buildId}.`,
          { expected: expected.identity, actual: { version: health.version, buildId: health.buildId } },
        );
      }
      if (expected.runtimeMode && health.runtimeMode !== expected.runtimeMode) {
        throw new LocalServerCompatibilityError(
          `Started local server reported ${health.runtimeMode} mode, expected ${expected.runtimeMode}.`,
        );
      }
      if (expected.ownership && !isVerifiedDesktopServerMarker(expected.ownership, health, baseUrl)) {
        throw new LocalServerCompatibilityError(
          'Started local server ownership proof does not match the launched process.',
        );
      }
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
  constructor({
    appRoot,
    resourcesRoot = appRoot,
    settingsPath,
    isPackaged = false,
    buildIdentity,
    appVersion,
    buildId,
    serverMarkerPath = SERVER_MARKER_PATH,
    choosePort = chooseServerPort,
    onChange,
    onLog,
    desktopOwnerNonce = crypto.randomBytes(32).toString('hex'),
  }) {
    this.appRoot = appRoot;
    this.resourcesRoot = resourcesRoot;
    this.settingsPath = settingsPath;
    this.isPackaged = isPackaged;
    this.buildIdentity = assertBuildIdentity(
      buildIdentity || { version: appVersion, buildId },
      { source: 'Desktop local-server identity' },
    );
    this.appVersion = this.buildIdentity.version;
    this.buildId = this.buildIdentity.buildId;
    this.serverMarkerPath = serverMarkerPath;
    this.choosePort = choosePort;
    this.nextDesktopOwnerNonce = desktopOwnerNonce;
    this.onChange = onChange;
    this.onLog = onLog;
    this.localServerUrl = null;
    this.localServerPort = null;
    this.ownedServerProcess = null;
    this.ensureLocalServerPromise = null;
    this.serverInstaller = null;
    this.verifiedLocalOrigin = null;
    this.verifiedServerProof = null;
    this.startupStage = 'idle';
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

  getStartupStage() {
    return this.startupStage;
  }

  setStartupStage(stage) {
    if (!LOCAL_STARTUP_STAGES.has(stage)) {
      throw new Error(`Unknown local startup stage: ${stage}`);
    }
    if (this.startupStage === stage) return;
    this.startupStage = stage;
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

  getBuildIdentity() {
    return this.buildIdentity;
  }

  getDesktopSessionSecret() {
    const secret = this.verifiedServerProof?.desktopOwnerNonce;
    return typeof secret === 'string' && secret ? secret : null;
  }

  async stopMismatchedManagedServer(marker, health, candidateUrl) {
    if (!isVerifiedDesktopServerMarker(marker, health, candidateUrl)) return false;

    // Re-read health immediately before signalling to narrow the PID-reuse and
    // stale-marker window. Any change converts this into the safe no-kill path.
    const latestHealth = await getCloudCliHealth(candidateUrl);
    if (!isVerifiedDesktopServerMarker(marker, latestHealth, candidateUrl)) return false;

    this.appendStartupLog(
      `Requesting shutdown of incompatible app-managed Local CloudCLI ${health.version} / ${health.buildId}.`,
    );
    const accepted = await requestDesktopShutdown(candidateUrl, marker.desktopOwnerNonce);
    if (!accepted) return false;

    const startedAt = Date.now();
    while (Date.now() - startedAt < SERVER_STOP_TIMEOUT_MS) {
      const runningHealth = await getCloudCliHealth(candidateUrl);
      if (!isVerifiedDesktopServerMarker(marker, runningHealth, candidateUrl)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new LocalServerCompatibilityError(
      'The incompatible app-managed local server did not stop in time.',
      { pid: marker.pid },
    );
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

  getRuntimeMode() {
    return this.desktopSettings.exposeLocalServerOnNetwork ? 'desktop-lan' : 'desktop-local';
  }

  async bootstrapLocalSession(electronSession) {
    await this.ensureLocalServer();
    if (this.getRuntimeMode() !== 'desktop-local') {
      return { success: false, skipped: true };
    }
    if (!electronSession?.cookies?.set || !this.localServerUrl) {
      throw new Error('Electron session storage is unavailable for local bootstrap.');
    }

    const nonce = createDesktopSessionNonce(crypto.randomBytes);
    const sessionSecret = this.getDesktopSessionSecret();
    if (!sessionSecret) {
      throw new LocalServerCompatibilityError(
        'The verified local server does not expose Desktop ownership for session bootstrap.',
      );
    }
    const response = await requestDesktopSession(
      this.getHealthCheckUrl() || this.localServerUrl,
      '/api/auth/desktop-bootstrap',
      sessionSecret,
      nonce,
    );
    const cookie = parseDesktopSessionCookie(response.setCookie);
    if (response.statusCode !== 200 || response.json?.success !== true || !cookie) {
      throw new LocalServerCompatibilityError(
        'Local server did not complete the passwordless Desktop session handshake.',
        { statusCode: response.statusCode },
      );
    }

    await electronSession.cookies.set({
      url: this.verifiedLocalOrigin || new URL(this.localServerUrl).origin,
      name: LOCAL_SESSION_COOKIE_NAME,
      value: cookie.value,
      path: '/',
      httpOnly: true,
      secure: cookie.secure,
      sameSite: 'strict',
      expirationDate: cookie.expirationDate,
    });
    return { success: true };
  }

  async createBrowserHandoffUrl() {
    await this.ensureLocalServer();
    if (!this.localServerUrl) {
      throw new Error('Local CloudCLI URL is not available yet.');
    }
    if (this.getRuntimeMode() !== 'desktop-local') {
      return this.getShareableWebUrl() || this.localServerUrl;
    }

    const nonce = createDesktopSessionNonce(crypto.randomBytes);
    const sessionSecret = this.getDesktopSessionSecret();
    if (!sessionSecret) {
      throw new LocalServerCompatibilityError(
        'The verified local server does not expose Desktop ownership for browser handoff.',
      );
    }
    const response = await requestDesktopSession(
      this.getHealthCheckUrl() || this.localServerUrl,
      '/api/auth/desktop-handoff',
      sessionSecret,
      nonce,
    );
    const pathValue = response.json?.path;
    if (
      response.statusCode !== 200
      || typeof pathValue !== 'string'
      || pathValue !== `/api/auth/desktop-handoff/${nonce}`
      || !isDesktopSessionNonce(nonce)
    ) {
      throw new LocalServerCompatibilityError(
        'Local server did not register a one-time browser handoff.',
        { statusCode: response.statusCode },
      );
    }
    return new URL(pathValue, this.localServerUrl).toString();
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
    if (key === 'exposeLocalServerOnNetwork') {
      throw new Error('LAN access must be changed through the authenticated LAN setup flow.');
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

  async configureLanAccess(electronSession, options = {}) {
    const enabled = options.enabled === true;
    const wasRunning = Boolean(this.localServerUrl);

    if (enabled) {
      await this.ensureLocalServer();
      if (this.getRuntimeMode() !== 'desktop-local') {
        return { success: true, runtimeMode: 'desktop-lan', alreadyEnabled: true };
      }
      await this.bootstrapLocalSession(electronSession);
      const nonce = createDesktopSessionNonce(crypto.randomBytes);
      const sessionSecret = this.getDesktopSessionSecret();
      if (!sessionSecret) {
        throw new LocalServerCompatibilityError(
          'The verified local server does not expose Desktop ownership for LAN setup.',
        );
      }
      const response = await requestDesktopSession(
        this.getHealthCheckUrl() || this.localServerUrl,
        '/api/auth/desktop-lan-credentials',
        sessionSecret,
        nonce,
        { username: options.username, password: options.password },
      );
      if (response.statusCode !== 200 || response.json?.success !== true) {
        throw new Error(response.json?.error?.message || 'Could not configure LAN sign-in credentials.');
      }
    }

    await this.saveDesktopSettings({
      ...this.desktopSettings,
      exposeLocalServerOnNetwork: enabled,
    });

    if (wasRunning || enabled) {
      await this.restartAndRepair();
      if (!enabled) await this.bootstrapLocalSession(electronSession);
    }

    return {
      success: true,
      runtimeMode: enabled ? 'desktop-lan' : 'desktop-local',
      restarted: wasRunning || enabled,
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
      buildIdentity: this.buildIdentity,
      bundleReleaseTag: bundleConfig.releaseTag,
      onLog: (line) => this.appendStartupLog(line),
    });
    this.serverInstaller = installer;
    const embeddedArchive = path.join(
      this.resourcesRoot,
      'embedded-server',
      installer.getBundleName(),
    );
    if (process.env.CLOUDCLI_USE_INSTALLED_SERVER !== '1' && await pathExists(embeddedArchive)) {
      try {
        return await installer.ensureInstalledFromArchive(embeddedArchive);
      } catch (error) {
        throw new LocalServerCompatibilityError(
          `Bundled local server is incompatible: ${error.message}`,
          { cause: error.message },
        );
      }
    }
    try {
      return await installer.ensureInstalled();
    } catch (error) {
      if (/identity|archive|checksum|incompatible/i.test(error.message)) {
        throw new LocalServerCompatibilityError(
          `Downloaded local server is incompatible: ${error.message}`,
          { cause: error.message },
        );
      }
      throw error;
    }
  }

  startBundledServer(port, serverEntry, launchNonce) {
    const bindHost = this.getServerBindHost();
    const runtime = getNodeRuntime(this.isPackaged);
    const serverCwd = getServerCwd(this.appRoot, serverEntry);
    const processStartedAt = new Date().toISOString();
    const desktopOwnerNonce = this.nextDesktopOwnerNonce;
    this.nextDesktopOwnerNonce = crypto.randomBytes(32).toString('hex');

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
        CLOUDCLI_DESKTOP_OWNER_NONCE: desktopOwnerNonce,
        CLOUDCLI_DESKTOP_PROCESS_STARTED_AT: processStartedAt,
        CLOUDCLI_DESKTOP_ALLOWED_ORIGIN: readLoopbackOrigin(process.env.ELECTRON_DEV_URL) || '',
        CLOUDCLI_RUNTIME_MODE: this.getRuntimeMode(),
        PATH: getDesktopPath(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.ownedServerProcess = child;
    child.cloudcliOwnership = {
      kind: 'managed',
      managedBy: 'cloudcli-desktop',
      pid: child.pid,
      url: `http://${HOST}:${port}`,
      version: this.appVersion,
      buildId: this.buildId,
      desktopLaunchNonce: launchNonce,
      desktopOwnerNonce,
      desktopProcessStartedAt: processStartedAt,
      runtimeMode: this.getRuntimeMode(),
    };

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
        if (this.verifiedServerProof?.pid === child.pid) {
          this.localServerUrl = null;
          this.localServerPort = null;
          this.verifiedLocalOrigin = null;
          this.verifiedServerProof = null;
          this.onChange?.();
        }
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
      const ready = await waitForCloudCliServer(defaultUrl, SERVER_START_TIMEOUT_MS, {
        identity: this.buildIdentity,
        runtimeMode: this.getRuntimeMode(),
      });
      if (!ready) {
        throw new Error(`Development backend did not become ready at ${defaultDisplayUrl}`);
      }
      const marker = await readServerMarker(this.serverMarkerPath);
      if (!isVerifiedDesktopServerMarker(marker, ready, defaultUrl)) {
        throw new LocalServerCompatibilityError(
          'Development backend is not owned by this Desktop session. Start it through the Desktop-managed runtime.',
        );
      }
      this.localServerPort = DEFAULT_PORT;
      this.verifiedLocalOrigin = new URL(devUrl).origin;
      this.verifiedServerProof = { kind: 'managed', ...marker };
      return devUrl;
    }

    if (!forceOwnServer) {
      const marker = await readServerMarker(this.serverMarkerPath);
      const candidateUrls = await getExistingServerCandidateUrls(defaultUrl, marker);
      for (const candidateUrl of candidateUrls) {
        const health = await getCloudCliHealth(candidateUrl);
        if (!health) continue;
        if (health.runtimeMode !== this.getRuntimeMode()) {
          const stopped = await this.stopMismatchedManagedServer(marker, health, candidateUrl);
          if (!stopped) {
            this.appendStartupLog(
              `Leaving server in ${health.runtimeMode} mode untouched; Desktop will start ${this.getRuntimeMode()} on another port.`,
            );
          }
          continue;
        }
        if (buildIdentitiesMatch(health, this.buildIdentity)) {
          const verifiedManagedServer = isVerifiedDesktopServerMarker(marker, health, candidateUrl);
          if (this.getRuntimeMode() === 'desktop-local' && !verifiedManagedServer) {
            this.appendStartupLog(
              `Leaving matching but unowned server at ${getDisplayUrl(candidateUrl)} untouched; passwordless Desktop requires an owned runtime.`,
            );
            continue;
          }
          if (!this.isPackaged || allowExistingServer || verifiedManagedServer) {
            const displayUrl = getDisplayUrl(candidateUrl);
            this.localServerPort = getPortFromUrl(candidateUrl);
            this.verifiedLocalOrigin = new URL(displayUrl).origin;
            this.verifiedServerProof = verifiedManagedServer
              ? { kind: 'managed', ...marker }
              : {
                  kind: 'identity-only',
                  url: candidateUrl,
                  runtimeMode: health.runtimeMode,
                  ...this.buildIdentity,
                };
            this.appendStartupLog(`Using existing Local CloudCLI at ${displayUrl}`);
            return displayUrl;
          }
          this.appendStartupLog(
            `Leaving matching but unowned server at ${getDisplayUrl(candidateUrl)} untouched; Desktop will start its managed runtime.`,
          );
          continue;
        }

        const stopped = await this.stopMismatchedManagedServer(marker, health, candidateUrl);
        if (!stopped) {
          this.appendStartupLog(
            `Leaving incompatible unowned server at ${getDisplayUrl(candidateUrl)} untouched; a matching server will use another loopback port.`,
          );
        }
      }
    }

    const serverEntry = await this.resolveServerEntry();

    const attemptedPorts = new Set();
    for (let attempt = 1; attempt <= MAX_SERVER_START_ATTEMPTS; attempt += 1) {
      const port = await this.choosePort(this.getServerBindHost(), attemptedPorts);
      attemptedPorts.add(port);
      const serverUrl = `http://${HOST}:${port}`;
      const displayUrl = `http://${DISPLAY_HOST}:${port}`;
      const launchNonce = crypto.randomBytes(32).toString('hex');
      this.localServerPort = port;
      const logStart = this.startupLogs.length;
      const child = this.startBundledServer(port, serverEntry, launchNonce);

      let ready;
      try {
        ready = await waitForCloudCliServer(serverUrl, SERVER_START_TIMEOUT_MS, {
          identity: this.buildIdentity,
          launchNonce,
          child,
          ownership: child.cloudcliOwnership,
          runtimeMode: this.getRuntimeMode(),
        });
      } catch (error) {
        await this.shutdownOwnedServer();
        await this.serverInstaller?.rollbackInstalledRuntime();
        throw error;
      }
      if (ready) {
        try {
          await this.serverInstaller?.confirmInstalledRuntime();
        } catch (error) {
          await this.shutdownOwnedServer();
          await this.serverInstaller?.rollbackInstalledRuntime();
          throw new LocalServerCompatibilityError(
            `Local server activation could not be finalized: ${error.message}`,
          );
        }
        this.verifiedServerProof = child.cloudcliOwnership;
        const finalHealth = await getCloudCliHealth(serverUrl);
        if (!isVerifiedServerProof(this.verifiedServerProof, finalHealth, serverUrl)) {
          await this.shutdownOwnedServer();
          throw new LocalServerCompatibilityError(
            'Local server lost its verified identity before the workspace could open.',
          );
        }
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
      await this.serverInstaller?.rollbackInstalledRuntime();
      this.localServerPort = null;
      this.verifiedLocalOrigin = null;
      this.verifiedServerProof = null;
      throw new LocalServerCompatibilityError([
        `Bundled backend did not become ready at ${displayUrl}.`,
        recentLogs ? `Recent startup output:\n${recentLogs}` : 'No startup output was captured.',
      ].join('\n\n'));
    }
    throw new Error('Bundled backend could not reserve a local port.');
  }

  async ensureLocalServer() {
    if (!this.ensureLocalServerPromise) {
      this.ensureLocalServerPromise = (async () => {
        if (this.localServerUrl) {
          const healthUrl = this.getHealthCheckUrl() || this.localServerUrl;
          const health = await getCloudCliHealth(healthUrl);
          if (isVerifiedServerProof(this.verifiedServerProof, health, healthUrl)) {
            return this.localServerUrl;
          }
          this.appendStartupLog('Running local server failed its compatibility re-check; repairing before workspace open.');
          await this.shutdownOwnedServer();
          this.localServerUrl = null;
          this.localServerPort = null;
          this.verifiedLocalOrigin = null;
          this.verifiedServerProof = null;
        }
        return this.resolveLocalServerUrl();
      })()
        .then((url) => {
          this.localServerUrl = url;
          return url;
        })
        .catch(async (error) => {
          await this.serverInstaller?.rollbackInstalledRuntime();
          throw error;
        })
        .finally(() => {
          this.ensureLocalServerPromise = null;
        });
    }
    return this.ensureLocalServerPromise;
  }

  async restartAndRepair() {
    if (this.ensureLocalServerPromise) {
      await this.ensureLocalServerPromise.catch(() => {});
    }
    await this.shutdownOwnedServer();
    this.localServerUrl = null;
    this.localServerPort = null;
    this.verifiedLocalOrigin = null;
    this.verifiedServerProof = null;
    return this.ensureLocalServer();
  }

  async verifyLocalServerCompatibility() {
    if (!this.localServerUrl) {
      throw new LocalServerCompatibilityError(
        'Local server is unavailable for the final compatibility check.',
      );
    }
    const healthUrl = this.getHealthCheckUrl() || this.localServerUrl;
    const health = await getCloudCliHealth(healthUrl);
    if (!isVerifiedServerProof(this.verifiedServerProof, health, healthUrl)) {
      throw new LocalServerCompatibilityError(
        'Local server identity or Desktop ownership changed before workspace open.',
      );
    }
    return health;
  }

  async getResolvedTarget() {
    await this.ensureLocalServer();
    await this.verifyLocalServerCompatibility();
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
    if (this.verifiedServerProof?.pid === child.pid) {
      this.localServerUrl = null;
      this.localServerPort = null;
      this.verifiedLocalOrigin = null;
      this.verifiedServerProof = null;
    }
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
