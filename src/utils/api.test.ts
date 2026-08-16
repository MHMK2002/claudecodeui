import assert from 'node:assert/strict';
import test from 'node:test';

type StoredValues = Map<string, string>;

function installBrowserFakes(options: {
  storedValues?: StoredValues;
  renew?: () => Promise<{ success: boolean }>;
  fetch: typeof globalThis.fetch;
}) {
  const values = options.storedValues ?? new Map<string, string>();
  const dispatched: string[] = [];
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      cloudcliDesktopLocalSession: options.renew ? { renew: options.renew } : undefined,
      dispatchEvent: (event: Event) => {
        dispatched.push(event.type);
        return true;
      },
    },
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: options.fetch,
  });
  return { values, dispatched };
}

test('desktop-local REST retries through tokenless Electron renewal without sending Bearer', async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  let renewCalls = 0;
  installBrowserFakes({
    storedValues: new Map([['auth-token', 'legacy.header.signature']]),
    renew: async () => {
      renewCalls += 1;
      return { success: true };
    },
    fetch: async (input, init) => {
      requests.push({ input: String(input), init });
      return requests.length === 1
        ? new Response('{}', {
            status: 401,
            headers: { 'X-Auth-Error': 'session-expired' },
          })
        : new Response('{"success":true}', { status: 200 });
    },
  });
  const apiModule = await import('./api.js');
  apiModule.setAuthRuntimeMode('desktop-local');

  const response = await apiModule.authenticatedFetch('/api/projects');

  assert.equal(response.status, 200);
  assert.equal(renewCalls, 1);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.has('Authorization'), false);
    assert.equal(request.init?.credentials, 'same-origin');
  }
});

test('desktop-local renewal failure emits recovery state instead of a Login session event', async () => {
  const runtime = installBrowserFakes({
    renew: async () => ({ success: false }),
    fetch: async () => new Response('{}', {
      status: 401,
      headers: { 'X-Auth-Error': 'session-expired' },
    }),
  });
  const apiModule = await import('./api.js');
  apiModule.setAuthRuntimeMode('desktop-local');

  const response = await apiModule.authenticatedFetch('/api/projects');

  assert.equal(response.status, 401);
  assert.deepEqual(runtime.dispatched, [apiModule.AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT]);
  assert.equal(runtime.dispatched.includes(apiModule.AUTH_SESSION_EXPIRED_EVENT), false);
});
