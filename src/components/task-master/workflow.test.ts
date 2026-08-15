import assert from 'node:assert/strict';
import test from 'node:test';

import type { Project } from '../../types/app';

import { startTaskIntake } from './workflow';

type CapturedRequest = {
  url: string;
  init: RequestInit;
};

const project: Project = {
  projectId: 'project-1',
  displayName: 'Project',
  fullPath: '/workspace/project',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installLocalStorage(): () => void {
  const original = globalThis.localStorage;
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  return () => Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: original,
  });
}

test('task intake uses the same explicit model for allocation and its first send', async () => {
  const restoreStorage = installLocalStorage();
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  const responses = [
    jsonResponse({ success: true, data: { sessionId: 'session-1' } }, 201),
    jsonResponse({ success: true, data: { intake: { id: 'intake-1' } } }, 201),
    jsonResponse({ success: true, data: { intake: { prompt: 'Clarify this', contentHash: 'hash-1' } } }),
  ];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    const response = responses.shift();
    assert.ok(response, 'unexpected request');
    return response;
  }) as typeof fetch;

  const sent: unknown[] = [];
  try {
    const result = await startTaskIntake({
      project,
      brief: 'Build a reliable task modal',
      selection: { provider: 'codex', providerProfileId: 42, model: 'gpt-test' },
      sendMessage: (message) => sent.push(message),
    });

    assert.deepEqual(result, { intakeId: 'intake-1', sessionId: 'session-1' });
    assert.deepEqual(requests.map((request) => request.url), [
      '/api/providers/sessions',
      '/api/taskmaster/workflow/project-1/intakes',
      '/api/taskmaster/workflow/project-1/intakes/intake-1/bind',
    ]);
    assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
      provider: 'codex',
      projectPath: '/workspace/project',
      providerProfileId: 42,
      model: 'gpt-test',
    });
    assert.deepEqual(sent, [{
      type: 'chat.send',
      sessionId: 'session-1',
      content: 'Clarify this',
      workflow: { kind: 'intake', id: 'intake-1', contentHash: 'hash-1' },
      options: { model: 'gpt-test' },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage();
  }
});

test('task intake discards its unbound session when intake creation fails', async () => {
  const restoreStorage = installLocalStorage();
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  const responses = [
    jsonResponse({ success: true, data: { sessionId: 'session-orphan' } }, 201),
    jsonResponse({ success: false, message: 'Intake creation failed' }, 500),
    jsonResponse({ success: true, data: { deleted: true } }),
  ];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    const response = responses.shift();
    assert.ok(response, 'unexpected request');
    return response;
  }) as typeof fetch;

  try {
    await assert.rejects(
      startTaskIntake({
        project,
        brief: 'Fail safely',
        selection: { provider: 'cursor', providerProfileId: null, model: 'cursor-test' },
        sendMessage: () => undefined,
      }),
      /Intake creation failed/,
    );
    assert.equal(requests[2]?.url, '/api/providers/sessions/session-orphan?force=true');
    assert.equal(requests[2]?.init.method, 'DELETE');
  } finally {
    globalThis.fetch = originalFetch;
    restoreStorage();
  }
});
