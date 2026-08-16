import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeSessionHistoryResponse } from './sessionHistoryTransport';

const validMessage = {
  id: 'message-1',
  sessionId: 'session-1',
  timestamp: '2026-08-16T00:00:00.000Z',
  provider: 'codex',
  kind: 'text',
  role: 'user',
  content: 'Keep this draft',
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  });
}

test('decodes the typed success envelope and JSON structured-suffix media types', async () => {
  const result = await decodeSessionHistoryResponse(jsonResponse({
    success: true,
    data: {
      messages: [validMessage],
      total: 1,
      hasMore: false,
      tokenUsage: { input: 10 },
    },
  }, {
    headers: { 'content-type': 'application/vnd.cloudcli+json' },
  }), 'session-1');

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data.messages, [validMessage]);
  assert.equal(result.data.total, 1);
  assert.equal(result.data.hasMore, false);
  assert.deepEqual(result.data.tokenUsage, { input: 10 });
});

test('checks HTTP status before attempting to parse an HTML error response', async () => {
  const result = await decodeSessionHistoryResponse(new Response('<h1>Unavailable</h1>', {
    status: 503,
    headers: { 'content-type': 'text/html' },
  }), 'session-1');

  assert.deepEqual(result, {
    ok: false,
    code: 'http',
    error: 'Conversation history request failed with HTTP 503.',
  });
});

test('rejects HTML before parsing and never exposes a JSON parser exception', async () => {
  const result = await decodeSessionHistoryResponse(new Response('<!doctype html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  }), 'session-1');

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'content-type');
  assert.doesNotMatch(result.error, /Unexpected token|</);
});

test('returns a discriminated invalid-json error', async () => {
  const result = await decodeSessionHistoryResponse(new Response('{not json', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }), 'session-1');

  assert.deepEqual(result, {
    ok: false,
    code: 'invalid-json',
    error: 'Conversation history returned invalid JSON.',
  });
});

test('rejects missing success envelopes and malformed pagination data', async (t) => {
  const cases: Array<{ name: string; body: unknown; code: string }> = [
    {
      name: 'direct data body',
      body: { messages: [], total: 0, hasMore: false },
      code: 'invalid-envelope',
    },
    {
      name: 'success false',
      body: { success: false, data: { messages: [], total: 0, hasMore: false } },
      code: 'invalid-envelope',
    },
    {
      name: 'messages is not an array',
      body: { success: true, data: { messages: {}, total: 0, hasMore: false } },
      code: 'invalid-data',
    },
    {
      name: 'total is negative',
      body: { success: true, data: { messages: [], total: -1, hasMore: false } },
      code: 'invalid-data',
    },
    {
      name: 'page contains more rows than total',
      body: { success: true, data: { messages: [validMessage], total: 0, hasMore: false } },
      code: 'invalid-data',
    },
    {
      name: 'hasMore is not boolean',
      body: { success: true, data: { messages: [], total: 0, hasMore: 'false' } },
      code: 'invalid-data',
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const result = await decodeSessionHistoryResponse(jsonResponse(fixture.body), 'session-1');
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, fixture.code);
    });
  }
});

test('rejects unsafe required and commonly rendered normalized-message fields', async (t) => {
  const cases = [
    { name: 'wrong session', message: { ...validMessage, sessionId: 'session-2' } },
    { name: 'invalid timestamp', message: { ...validMessage, timestamp: 'not-a-date' } },
    { name: 'unknown provider', message: { ...validMessage, provider: 'unknown' } },
    { name: 'unknown kind', message: { ...validMessage, kind: 'unknown' } },
    { name: 'unsafe content', message: { ...validMessage, content: { html: true } } },
    { name: 'unsafe tool result', message: { ...validMessage, toolResult: { content: 'ok' } } },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const result = await decodeSessionHistoryResponse(jsonResponse({
        success: true,
        data: { messages: [fixture.message], total: 1, hasMore: false },
      }), 'session-1');
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, 'invalid-message');
    });
  }
});
