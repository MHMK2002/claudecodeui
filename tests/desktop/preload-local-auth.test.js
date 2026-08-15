import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const preloadSource = await readFile(
  new URL('../../electron/preload.cjs', import.meta.url),
  'utf8',
);

function runPreload({ hostname, persistedToken = null, initialToken = null }) {
  const values = new Map();
  if (initialToken) values.set('auth-token', initialToken);
  const sent = [];
  const intervals = [];
  const ipcRenderer = {
    invoke() {},
    on() {},
    removeListener() {},
    send(channel, value) {
      sent.push([channel, value]);
    },
    sendSync(channel) {
      sent.push([channel]);
      return persistedToken;
    },
  };
  const window = {
    location: { protocol: 'http:', hostname },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };

  vm.runInNewContext(preloadSource, {
    require: () => ({ contextBridge: { exposeInMainWorld() {} }, ipcRenderer }),
    setInterval(callback) {
      intervals.push(callback);
      return intervals.length;
    },
    window,
  });

  return { intervals, sent, values };
}

test('preload restores desktop auth before the local app starts on a new origin', () => {
  const runtime = runPreload({ hostname: 'localhost', persistedToken: 'persisted-token' });

  assert.equal(runtime.values.get('auth-token'), 'persisted-token');
  assert.deepEqual(runtime.sent, [
    ['cloudcli-desktop:get-local-auth-token'],
    ['cloudcli-desktop:update-local-auth-token', 'persisted-token'],
  ]);
});

test('preload mirrors login and logout changes back to the desktop store', () => {
  const runtime = runPreload({ hostname: '127.0.0.1', initialToken: 'first-token' });
  const poll = runtime.intervals[0];

  runtime.values.set('auth-token', 'refreshed-token');
  poll();
  runtime.values.delete('auth-token');
  poll();

  assert.deepEqual(runtime.sent.slice(-2), [
    ['cloudcli-desktop:update-local-auth-token', 'refreshed-token'],
    ['cloudcli-desktop:update-local-auth-token', null],
  ]);
});

test('preload never requests desktop credentials for a remote origin', () => {
  const runtime = runPreload({ hostname: 'example.com', persistedToken: 'persisted-token' });

  assert.equal(runtime.values.has('auth-token'), false);
  assert.deepEqual(runtime.sent, []);
});
