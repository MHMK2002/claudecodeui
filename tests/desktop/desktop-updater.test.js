import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DESKTOP_UPDATER_CHANNELS,
  DesktopUpdaterController,
  assertTrustedUpdaterOrigin,
  createDesktopInstallPreparation,
  registerDesktopUpdaterIpc,
} from '../../electron/desktopUpdater.js';

const mainSource = await readFile(new URL('../../electron/main.js', import.meta.url), 'utf8');

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCount = 0;
    this.installArguments = null;
  }

  async checkForUpdates() {
    this.checkCount += 1;
  }

  quitAndInstall(...args) {
    this.installArguments = args;
  }
}

function createController(overrides = {}) {
  const updater = overrides.updater || new FakeUpdater();
  const timers = [];
  const intervals = [];
  const controller = new DesktopUpdaterController({
    updater,
    isPackaged: true,
    currentVersion: '1.2.3',
    buildId: '1.2.3+abc123',
    releasesUrl: 'https://github.com/MHMK2002/claudecodeui/releases',
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn() {},
    setIntervalFn(callback, delay) {
      const timer = { callback, delay, unref() {} };
      intervals.push(timer);
      return timer;
    },
    clearIntervalFn() {},
    ...overrides,
  });
  return { controller, updater, timers, intervals };
}

test('desktop updater is disabled for unpackaged development builds', async () => {
  const updater = new FakeUpdater();
  const controller = new DesktopUpdaterController({
    updater,
    isPackaged: false,
    currentVersion: '1.2.3',
    buildId: 'dev-build',
  });

  const state = controller.start();
  assert.equal(state.enabled, false);
  assert.equal(state.phase, 'disabled');
  assert.match(state.disabledReason, /packaged desktop builds/i);
  await controller.checkNow();
  assert.equal(updater.checkCount, 0);
});

test('desktop updater checks automatically and exposes truthful download stages', async () => {
  const states = [];
  const { controller, updater, timers, intervals } = createController({
    onStateChange: (state) => states.push(state),
  });
  controller.start();

  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(timers.length, 1);
  assert.equal(intervals.length, 1);

  await timers[0].callback();
  assert.equal(updater.checkCount, 1);
  updater.emit('update-available', {
    version: '1.3.0',
    releaseName: 'CloudCLI 1.3.0',
    releaseNotes: 'A safer updater\n\n- With progress',
    releaseDate: '2026-08-16T00:00:00.000Z',
  });
  assert.equal(controller.getState().phase, 'available');
  assert.deepEqual(controller.getState().release, {
    version: '1.3.0',
    title: 'CloudCLI 1.3.0',
    notes: 'A safer updater\n\n- With progress',
    publishedAt: '2026-08-16T00:00:00.000Z',
    releaseUrl: 'https://github.com/MHMK2002/claudecodeui/releases',
  });

  updater.emit('download-progress', {
    percent: 52.75,
    transferred: 5275,
    total: 10000,
    bytesPerSecond: 2048,
  });
  assert.deepEqual(controller.getState().progress, {
    percent: 52.75,
    transferred: 5275,
    total: 10000,
    bytesPerSecond: 2048,
  });
  assert.equal(controller.getState().phase, 'downloading');

  updater.emit('update-downloaded', { version: '1.3.0' });
  assert.equal(controller.getState().phase, 'ready');
  assert.equal(controller.getState().progress.percent, 100);
  assert.ok(states.some((state) => state.phase === 'checking'));
});

test('restart and install shuts down the owned server before invoking the installer', async () => {
  const order = [];
  const { controller, updater } = createController({
    beforeInstall: async () => {
      order.push('shutdown');
    },
  });
  updater.quitAndInstall = (...args) => {
    order.push('install');
    updater.installArguments = args;
  };
  controller.start();
  updater.emit('update-downloaded', { version: '1.3.0' });

  const state = await controller.restartAndInstall();
  assert.deepEqual(order, ['shutdown', 'install']);
  assert.deepEqual(updater.installArguments, [false, true]);
  assert.equal(state.phase, 'installing');
});

test('failed installer launch restores the local workspace before surfacing recovery', async () => {
  const order = [];
  const updater = new FakeUpdater();
  updater.quitAndInstall = () => {
    order.push('install');
    throw new Error('Installer launch failed');
  };
  const { controller } = createController({
    updater,
    beforeInstall: async () => {
      order.push('shutdown');
      return async () => {
        order.push('restore-workspace');
      };
    },
  });
  controller.start();
  updater.emit('update-downloaded', { version: '1.3.0' });

  await assert.rejects(controller.restartAndInstall(), /Installer launch failed/);
  assert.deepEqual(order, ['shutdown', 'install', 'restore-workspace']);
  assert.equal(controller.getState().phase, 'error');
});

test('asynchronous installer errors restore the prepared workspace exactly once', async () => {
  let recoveryCount = 0;
  const updater = new FakeUpdater();
  updater.quitAndInstall = () => {
    updater.emit('error', new Error('Installer reported a delayed failure'));
  };
  const { controller } = createController({
    updater,
    beforeInstall: async () => async () => {
      recoveryCount += 1;
    },
  });
  controller.start();
  updater.emit('update-downloaded', { version: '1.3.0' });

  await controller.restartAndInstall();
  await new Promise((resolve) => setImmediate(resolve));
  updater.emit('error', new Error('Duplicate installer failure'));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(recoveryCount, 1);
  assert.equal(controller.getState().phase, 'error');
});

test('desktop bootstrap wires the dependency-injected install preparation', () => {
  assert.match(mainSource, /beforeInstall: createDesktopInstallPreparation\(\{/);
  assert.match(mainSource, /hasOwnedServer: \(\) => localServer\.hasOwnedServer\(\)/);
  assert.match(mainSource, /notificationsEnabled: \(\) => desktopNotifications\?\.getState\(\)\.enabled === true/);
  assert.match(mainSource, /shutdownOwnedServer: \(\) => localServer\.shutdownOwnedServer\(\)/);
  assert.match(mainSource, /restoreWorkspace: \(\) => openLocalInDesktop\(\)/);
  assert.match(mainSource, /restoreNotifications: \(\) => desktopNotifications\?\.sync\(\)/);
});

test('install preparation recovers a partial shutdown and preserves the original failure', async () => {
  const original = new Error('shutdown failed');
  const order = [];
  const prepare = createDesktopInstallPreparation({
    hasOwnedServer: () => true,
    notificationsEnabled: () => true,
    stopNotifications: () => order.push('stop-notifications'),
    shutdownOwnedServer: async () => {
      order.push('shutdown-workspace');
      throw original;
    },
    restoreWorkspace: async () => order.push('restore-workspace'),
    restoreNotifications: async () => order.push('restore-notifications'),
  });

  await assert.rejects(prepare(), (error) => error === original);
  assert.deepEqual(order, [
    'stop-notifications',
    'shutdown-workspace',
    'restore-workspace',
    'restore-notifications',
  ]);
});

test('install recovery is idempotent and restores notifications after workspace recovery fails', async () => {
  const diagnostics = [];
  let notificationRecoveries = 0;
  const prepare = createDesktopInstallPreparation({
    hasOwnedServer: () => true,
    notificationsEnabled: () => true,
    stopNotifications() {},
    async shutdownOwnedServer() {},
    async restoreWorkspace() {
      throw new Error('https://example.test/recover?token=workspace-secret github_pat_PRIVATE');
    },
    async restoreNotifications() {
      notificationRecoveries += 1;
    },
    onDiagnostic(event, details) {
      diagnostics.push({ event, details });
      return Promise.reject(new Error('diagnostic sink rejected'));
    },
  });

  const recover = await prepare();
  await assert.rejects(
    Promise.all([recover(), recover()]),
    /Desktop install recovery did not complete/,
  );
  assert.equal(notificationRecoveries, 1);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].details.step, 'workspace');
  assert.doesNotMatch(diagnostics[0].details.message, /workspace-secret|github_pat_PRIVATE/);
  assert.match(diagnostics[0].details.message, /\[redacted\]/);
});

test('partial install recovery reports failure only after every owned step is attempted', async () => {
  const diagnostics = [];
  let notificationRecoveries = 0;
  const updater = new FakeUpdater();
  updater.quitAndInstall = () => {
    throw new Error('Installer launch failed');
  };
  const beforeInstall = createDesktopInstallPreparation({
    hasOwnedServer: () => true,
    notificationsEnabled: () => true,
    stopNotifications() {},
    async shutdownOwnedServer() {},
    async restoreWorkspace() {
      throw new Error('Workspace restore failed');
    },
    async restoreNotifications() {
      notificationRecoveries += 1;
    },
    onDiagnostic(event, details) {
      diagnostics.push({ event, details });
    },
  });
  const { controller } = createController({
    updater,
    beforeInstall,
    onDiagnostic(event, details) {
      diagnostics.push({ event, details });
    },
  });
  controller.start();
  updater.emit('update-downloaded', { version: '1.3.0' });

  await assert.rejects(controller.restartAndInstall(), /Installer launch failed/);
  assert.equal(notificationRecoveries, 1);
  assert.equal(
    diagnostics.some(({ event }) => event === 'updater.install-recovery-failed'),
    true,
  );
  assert.equal(
    diagnostics.some(({ event }) => event === 'updater.install-recovered'),
    false,
  );
  assert.match(controller.getState().error.message, /Installer launch failed/);
});

test('synchronous updater emit plus throw keeps the first failure authoritative', async () => {
  let recoveryCount = 0;
  const updater = new FakeUpdater();
  updater.quitAndInstall = () => {
    updater.emit('error', new Error('first emitted failure'));
    throw new Error('later thrown failure');
  };
  const { controller } = createController({
    updater,
    beforeInstall: async () => async () => {
      recoveryCount += 1;
    },
  });
  controller.start();
  updater.emit('update-downloaded', { version: '1.3.0' });

  await assert.rejects(controller.restartAndInstall(), /first emitted failure/);
  assert.equal(recoveryCount, 1);
  assert.match(controller.getState().error.message, /first emitted failure/);
  assert.doesNotMatch(controller.getState().error.message, /later thrown failure/);
});

test('duplicate install events cannot replace a pending or terminal attempt', async () => {
  let finishRecovery;
  let recoveryCount = 0;
  const recoveryBlocked = new Promise((resolve) => {
    finishRecovery = resolve;
  });
  const updater = new FakeUpdater();
  updater.quitAndInstall = () => {
    updater.emit('error', new Error('authoritative async failure'));
  };
  const { controller } = createController({
    updater,
    beforeInstall: async () => async () => {
      recoveryCount += 1;
      await recoveryBlocked;
    },
  });
  controller.start();
  updater.emit('update-downloaded', { version: '1.3.0' });
  await controller.restartAndInstall();

  updater.emit('error', new Error('duplicate while pending'));
  updater.emit('update-downloaded', { version: '9.9.9' });
  assert.equal(controller.getState().phase, 'installing');
  assert.equal(controller.getState().release.version, '1.3.0');

  finishRecovery();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recoveryCount, 1);
  assert.equal(controller.getState().phase, 'error');
  const terminalError = controller.getState().error;

  updater.emit('error', new Error('duplicate after terminal'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(controller.getState().error, terminalError);

  updater.emit('update-downloaded', { version: '1.3.0' });
  updater.quitAndInstall = () => {};
  assert.equal(controller.getState().phase, 'ready');
  assert.equal((await controller.restartAndInstall()).phase, 'installing');
  assert.equal(recoveryCount, 1);
});

test('a new explicit check handles updater errors after a terminal install attempt', async () => {
  const updater = new FakeUpdater();
  updater.quitAndInstall = () => {
    throw new Error('Terminal install failure');
  };
  const { controller } = createController({ updater });
  controller.start();
  updater.emit('update-downloaded', { version: '1.3.0' });
  await assert.rejects(controller.restartAndInstall(), /Terminal install failure/);

  updater.checkForUpdates = async () => {
    updater.emit('error', new Error('Fresh update check failure'));
  };
  const state = await controller.checkNow();
  assert.equal(state.phase, 'error');
  assert.match(state.error.message, /Fresh update check failure/);
});

test('throwing and rejected diagnostic sinks never mask the sanitized install failure', async () => {
  for (const onDiagnostic of [
    () => { throw new Error('synchronous diagnostic failure'); },
    async () => { throw new Error('asynchronous diagnostic failure'); },
  ]) {
    const updater = new FakeUpdater();
    updater.quitAndInstall = () => {
      throw new Error('Install https://example.test/file?token=private github_pat_EXPOSED');
    };
    const { controller } = createController({ updater, onDiagnostic });
    controller.start();
    updater.emit('update-downloaded', { version: '1.3.0' });

    await assert.rejects(
      controller.restartAndInstall(),
      (error) => /\[redacted\]/.test(error.message) && !/private|github_pat_EXPOSED/.test(error.message),
    );
  }
});

test('desktop updater returns a sanitized recoverable error', async () => {
  const updater = new FakeUpdater();
  updater.checkForUpdates = async () => {
    throw Object.assign(
      new Error('Download https://example.test/update?token=top-secret authorization: BearerValue github_pat_EXPOSED'),
      { code: 'ERR_UPDATER' },
    );
  };
  const { controller } = createController({ updater });
  controller.start();

  const state = await controller.checkNow();
  assert.equal(state.phase, 'error');
  assert.equal(state.error.code, 'ERR_UPDATER');
  assert.equal(state.error.recoverable, true);
  assert.doesNotMatch(state.error.message, /top-secret|BearerValue|github_pat_EXPOSED/);
  assert.match(state.error.message, /\[redacted\]/);
});

test('updater IPC accepts only the exact verified local origin', async () => {
  const handlers = new Map();
  const calls = [];
  const controller = {
    getState: () => ({ phase: 'idle' }),
    checkNow: async () => {
      calls.push('check');
      return { phase: 'checking' };
    },
    restartAndInstall: async () => {
      calls.push('install');
      return { phase: 'installing' };
    },
  };
  registerDesktopUpdaterIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    controller,
    getVerifiedOrigin: () => 'http://127.0.0.1:4312',
  });
  const trustedEvent = { senderFrame: { url: 'http://127.0.0.1:4312/projects/1' } };

  assert.deepEqual(
    await handlers.get(DESKTOP_UPDATER_CHANNELS.getState)(trustedEvent),
    { phase: 'idle' },
  );
  await handlers.get(DESKTOP_UPDATER_CHANNELS.check)(trustedEvent);
  await handlers.get(DESKTOP_UPDATER_CHANNELS.restartAndInstall)(trustedEvent);
  assert.deepEqual(calls, ['check', 'install']);

  for (const senderUrl of [
    'http://127.0.0.1:4313/projects/1',
    'http://localhost:4312/projects/1',
    'https://example.com/projects/1',
    'file:///tmp/launcher.html',
  ]) {
    await assert.rejects(
      handlers.get(DESKTOP_UPDATER_CHANNELS.getState)({ senderFrame: { url: senderUrl } }),
      /unavailable for this page/i,
    );
  }
});

test('updater origin assertion fails closed without a verified origin', () => {
  assert.throws(
    () => assertTrustedUpdaterOrigin('http://127.0.0.1:4312/projects/1', null),
    /unavailable for this page/i,
  );
});
