import { redactDiagnosticValue } from './diagnostics.js';
import { isExactVerifiedOrigin } from './localOrigin.js';

export const DESKTOP_UPDATER_CHANNELS = Object.freeze({
  getState: 'cloudcli-desktop:updater-get-state',
  check: 'cloudcli-desktop:updater-check',
  restartAndInstall: 'cloudcli-desktop:updater-restart-and-install',
  stateChanged: 'cloudcli-desktop:updater-state-changed',
});

const ACTIVE_PHASES = new Set(['checking', 'downloading', 'installing']);
const MAX_RELEASE_NOTES_LENGTH = 20_000;
const MAX_ERROR_LENGTH = 500;

function clamp(value, minimum, maximum) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(maximum, Math.max(minimum, numericValue));
}

function safeText(value, maximumLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximumLength);
}

function safeMultilineText(value, maximumLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maximumLength);
}

function sanitizeErrorMessage(error) {
  const rawMessage = error instanceof Error ? error.message : String(error || 'Unknown update error.');
  return safeText(redactDiagnosticValue(rawMessage), MAX_ERROR_LENGTH)
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1?[redacted]')
    .replace(/\b(bearer|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, '[redacted]')
    .replace(/\bgh[opusr]_[A-Za-z0-9_]+\b/g, '[redacted]');
}

function emitDiagnosticSafely(sink, event, details) {
  try {
    Promise.resolve(sink(event, details)).catch(() => {});
  } catch {
    // Diagnostics must never change updater control flow.
  }
}

function normalizeReleaseNotes(releaseNotes) {
  if (typeof releaseNotes === 'string') {
    return safeMultilineText(releaseNotes, MAX_RELEASE_NOTES_LENGTH);
  }

  if (!Array.isArray(releaseNotes)) return '';
  return safeMultilineText(
    releaseNotes
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (!entry || typeof entry !== 'object') return '';
        const version = safeText(entry.version, 64);
        const note = safeMultilineText(entry.note, 4_000);
        return version && note ? `## ${version}\n\n${note}` : note;
      })
      .filter(Boolean)
      .join('\n\n'),
    MAX_RELEASE_NOTES_LENGTH,
  );
}

function normalizeRelease(info, releasesUrl) {
  if (!info || typeof info !== 'object') return null;
  const version = safeText(info.version, 64).replace(/^v/, '');
  if (!version) return null;

  return {
    version,
    title: safeText(info.releaseName, 200) || `v${version}`,
    notes: normalizeReleaseNotes(info.releaseNotes),
    publishedAt: safeText(info.releaseDate, 64) || null,
    releaseUrl: releasesUrl,
  };
}

function normalizeProgress(progress) {
  if (!progress || typeof progress !== 'object') return null;
  return {
    percent: clamp(progress.percent, 0, 100),
    transferred: clamp(progress.transferred, 0, Number.MAX_SAFE_INTEGER),
    total: clamp(progress.total, 0, Number.MAX_SAFE_INTEGER),
    bytesPerSecond: clamp(progress.bytesPerSecond, 0, Number.MAX_SAFE_INTEGER),
  };
}

function cloneState(state) {
  return {
    ...state,
    release: state.release ? { ...state.release } : null,
    progress: state.progress ? { ...state.progress } : null,
    error: state.error ? { ...state.error } : null,
  };
}

export function assertTrustedUpdaterOrigin(senderUrl, verifiedOrigin) {
  if (!isExactVerifiedOrigin(senderUrl, verifiedOrigin)) {
    throw new Error('Desktop updates are unavailable for this page.');
  }
}

export function registerDesktopUpdaterIpc({ ipcMain, controller, getVerifiedOrigin }) {
  const authorize = (event) => {
    assertTrustedUpdaterOrigin(event.senderFrame?.url, getVerifiedOrigin());
  };

  ipcMain.handle(DESKTOP_UPDATER_CHANNELS.getState, async (event) => {
    authorize(event);
    return controller.getState();
  });
  ipcMain.handle(DESKTOP_UPDATER_CHANNELS.check, async (event) => {
    authorize(event);
    return controller.checkNow();
  });
  ipcMain.handle(DESKTOP_UPDATER_CHANNELS.restartAndInstall, async (event) => {
    authorize(event);
    return controller.restartAndInstall();
  });
}

export function createDesktopInstallPreparation({
  hasOwnedServer = () => false,
  notificationsEnabled = () => false,
  stopNotifications = () => {},
  shutdownOwnedServer = async () => {},
  restoreWorkspace = async () => {},
  restoreNotifications = async () => {},
  onDiagnostic = () => {},
} = {}) {
  return async function prepareDesktopInstall() {
    const ownedServer = Boolean(hasOwnedServer());
    const enabledNotifications = Boolean(notificationsEnabled());
    let workspaceShutdownAttempted = false;
    let notificationStopAttempted = false;
    let recoveryPromise = null;

    const recover = () => {
      if (recoveryPromise) return recoveryPromise;
      recoveryPromise = (async () => {
        const recoveryErrors = [];
        if (ownedServer && workspaceShutdownAttempted) {
          try {
            await restoreWorkspace();
          } catch (error) {
            recoveryErrors.push(error);
            emitDiagnosticSafely(onDiagnostic, 'updater.install-recovery-step-failed', {
              step: 'workspace',
              message: sanitizeErrorMessage(error),
            });
          }
        }
        if (enabledNotifications && notificationStopAttempted) {
          try {
            await restoreNotifications();
          } catch (error) {
            recoveryErrors.push(error);
            emitDiagnosticSafely(onDiagnostic, 'updater.install-recovery-step-failed', {
              step: 'notifications',
              message: sanitizeErrorMessage(error),
            });
          }
        }
        if (recoveryErrors.length > 0) {
          throw new AggregateError(
            recoveryErrors,
            'Desktop install recovery did not complete.',
          );
        }
      })();
      return recoveryPromise;
    };

    try {
      if (enabledNotifications) {
        notificationStopAttempted = true;
        await stopNotifications();
      }
      if (ownedServer) {
        workspaceShutdownAttempted = true;
        await shutdownOwnedServer();
      }
      return recover;
    } catch (error) {
      try {
        await recover();
      } catch {
        // Per-step recovery diagnostics were already emitted; keep the
        // preparation failure authoritative for the caller.
      }
      throw error;
    }
  };
}

export class DesktopUpdaterController {
  constructor({
    updater,
    isPackaged,
    currentVersion,
    buildId,
    releasesUrl,
    beforeInstall,
    onStateChange = () => {},
    onDiagnostic = () => {},
    initialCheckDelayMs = 15_000,
    checkIntervalMs = 4 * 60 * 60 * 1_000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  }) {
    if (!updater && isPackaged) {
      throw new Error('Packaged desktop updater requires an updater implementation.');
    }
    this.updater = updater;
    this.isPackaged = Boolean(isPackaged);
    this.beforeInstall = beforeInstall;
    this.onStateChange = onStateChange;
    this.onDiagnostic = onDiagnostic;
    this.initialCheckDelayMs = initialCheckDelayMs;
    this.checkIntervalMs = checkIntervalMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.releasesUrl = releasesUrl;
    this.started = false;
    this.initialTimer = null;
    this.intervalTimer = null;
    this.listeners = [];
    this.installAttempt = null;
    this.installAttemptSequence = 0;
    this.state = {
      enabled: false,
      phase: 'disabled',
      currentVersion,
      buildId,
      checkedAt: null,
      release: null,
      progress: null,
      error: null,
      disabledReason: 'Updater has not started.',
    };
  }

  getState() {
    return cloneState(this.state);
  }

  start() {
    if (this.started) return this.getState();
    this.started = true;

    if (!this.isPackaged) {
      this.transition({
        enabled: false,
        phase: 'disabled',
        disabledReason: 'Automatic updates are available in packaged desktop builds.',
      });
      return this.getState();
    }

    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowDowngrade = false;
    this.updater.allowPrerelease = false;
    this.bindUpdaterEvents();
    this.transition({ enabled: true, phase: 'idle', disabledReason: null });

    this.initialTimer = this.setTimeoutFn(() => {
      void this.checkNow({ source: 'automatic' });
    }, this.initialCheckDelayMs);
    this.initialTimer?.unref?.();
    this.intervalTimer = this.setIntervalFn(() => {
      void this.checkNow({ source: 'automatic' });
    }, this.checkIntervalMs);
    this.intervalTimer?.unref?.();
    return this.getState();
  }

  stop() {
    if (this.initialTimer) this.clearTimeoutFn(this.initialTimer);
    if (this.intervalTimer) this.clearIntervalFn(this.intervalTimer);
    this.initialTimer = null;
    this.intervalTimer = null;
    this.installAttempt = null;
    for (const [eventName, listener] of this.listeners) {
      this.updater.off?.(eventName, listener);
    }
    this.listeners = [];
  }

  async checkNow({ source = 'manual' } = {}) {
    if (!this.state.enabled || ACTIVE_PHASES.has(this.state.phase)) return this.getState();
    if (this.installAttempt?.terminal) this.installAttempt = null;
    this.transition({ phase: 'checking', progress: null, error: null });
    this.emitDiagnostic('updater.check-started', { source });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.handleError(error);
    }
    return this.getState();
  }

  async restartAndInstall() {
    if (!this.state.enabled || this.state.phase !== 'ready') {
      throw new Error('The update has not finished downloading yet.');
    }

    const attempt = {
      id: ++this.installAttemptSequence,
      recovery: null,
      recoveryPromise: null,
      firstError: null,
      terminal: false,
    };
    this.installAttempt = attempt;
    this.transition({ phase: 'installing', error: null });
    this.emitDiagnostic('updater.install-started', { version: this.state.release?.version || null });
    try {
      const recovery = await this.beforeInstall?.();
      attempt.recovery = typeof recovery === 'function' ? recovery : null;
      if (attempt.firstError || attempt.terminal) {
        await this.failInstallAttempt(attempt, attempt.firstError);
        throw attempt.firstError;
      }
      this.updater.quitAndInstall(false, true);
      return this.getState();
    } catch (error) {
      await this.failInstallAttempt(attempt, error);
      throw new Error(sanitizeErrorMessage(attempt.firstError || error));
    }
  }

  async failInstallAttempt(attempt, error) {
    if (!attempt || attempt !== this.installAttempt) return;
    if (!attempt.firstError) attempt.firstError = error || new Error('The update could not be installed.');
    if (attempt.recoveryPromise) return attempt.recoveryPromise;
    if (attempt.terminal) return;

    attempt.recoveryPromise = (async () => {
      if (attempt.recovery) {
        try {
          await attempt.recovery();
          this.emitDiagnostic('updater.install-recovered');
        } catch (recoveryError) {
          this.emitDiagnostic('updater.install-recovery-failed', {
            message: sanitizeErrorMessage(recoveryError),
          });
        }
      }
      this.handleError(attempt.firstError);
    })().finally(() => {
      attempt.terminal = true;
    });
    return attempt.recoveryPromise;
  }

  bindUpdaterEvents() {
    this.on('checking-for-update', () => {
      this.transition({ phase: 'checking', progress: null, error: null });
    });
    this.on('update-available', (info) => {
      this.transition({
        phase: 'available',
        checkedAt: new Date().toISOString(),
        release: normalizeRelease(info, this.releasesUrl),
        progress: null,
        error: null,
      });
    });
    this.on('update-not-available', () => {
      this.transition({
        phase: 'not-available',
        checkedAt: new Date().toISOString(),
        release: null,
        progress: null,
        error: null,
      });
    });
    this.on('download-progress', (progress) => {
      this.transition({ phase: 'downloading', progress: normalizeProgress(progress), error: null });
    });
    this.on('update-downloaded', (info) => {
      if (this.installAttempt && !this.installAttempt.terminal) return;
      this.transition({
        phase: 'ready',
        release: normalizeRelease(info, this.releasesUrl) || this.state.release,
        progress: { ...(this.state.progress || {}), percent: 100 },
        error: null,
      });
    });
    this.on('error', (error) => {
      if (this.installAttempt) {
        void this.failInstallAttempt(this.installAttempt, error);
        return;
      }
      this.handleError(error);
    });
  }

  on(eventName, listener) {
    this.updater.on(eventName, listener);
    this.listeners.push([eventName, listener]);
  }

  handleError(error) {
    const message = sanitizeErrorMessage(error) || 'The update could not be completed.';
    const code = safeText(error?.code, 80) || null;
    this.transition({
      phase: 'error',
      error: { message, code, recoverable: true },
      progress: null,
    });
    this.emitDiagnostic('updater.error', { code, message });
  }

  emitDiagnostic(event, details) {
    emitDiagnosticSafely(this.onDiagnostic, event, details);
  }

  transition(patch) {
    this.state = { ...this.state, ...patch };
    this.onStateChange(this.getState());
  }
}

export const desktopUpdaterInternals = Object.freeze({
  normalizeProgress,
  normalizeRelease,
  sanitizeErrorMessage,
});
