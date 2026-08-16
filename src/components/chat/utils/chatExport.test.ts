import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessage } from '../types/types';

import { downloadPDF, EXPORT_FORMATS } from './chatExport';

const messages: ChatMessage[] = [{
  type: 'user',
  content: 'Keep this draft',
  timestamp: '2026-08-16T00:00:00.000Z',
}];

test('PDF popup blocking throws a contextual error and never calls alert', async () => {
  const previousWindow = globalThis.window;
  let alertCalls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      open: () => null,
      alert: () => { alertCalls += 1; },
    },
  });
  try {
    await assert.rejects(
      downloadPDF(messages, 'chat', 'Session'),
      /browser blocked the PDF window/i,
    );
    assert.equal(alertCalls, 0);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});

test('PDF uses the Desktop bridge with escaped HTML and returns its awaited outcome', async () => {
  const previousWindow = globalThis.window;
  const receivedPayloads: Array<{ html: string; suggestedFilename: string }> = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      cloudcliDesktopPdf: {
        exportPdf: async (payload: { html: string; suggestedFilename: string }) => {
          receivedPayloads.push(payload);
          return { status: 'saved' as const };
        },
      },
      open: () => { throw new Error('Desktop PDF must not use window.open.'); },
    },
  });

  try {
    const result = await downloadPDF([{
      ...messages[0],
      content: '<script>steal()</script> & private',
    }], 'session-export', '<Admin>');

    assert.deepEqual(result, { status: 'saved' });
    const receivedPayload = receivedPayloads[0];
    assert.ok(receivedPayload);
    assert.equal(receivedPayload.suggestedFilename, 'session-export.pdf');
    assert.match(receivedPayload.html, /&lt;script&gt;steal\(\)&lt;\/script&gt; &amp; private/);
    assert.match(receivedPayload.html, /&lt;Admin&gt;/);
    assert.doesNotMatch(receivedPayload.html, /<script>steal\(\)<\/script>/);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});

test('PDF preserves an explicit Desktop cancellation outcome', async () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      cloudcliDesktopPdf: {
        exportPdf: async () => ({ status: 'cancelled' as const }),
      },
    },
  });
  try {
    assert.deepEqual(await downloadPDF(messages, 'chat', 'Session'), { status: 'cancelled' });
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});

test('the canonical export menu has exactly Markdown, HTML, PDF, and ZIP', () => {
  assert.deepEqual(EXPORT_FORMATS.map((format) => format.id), [
    'markdown',
    'html',
    'pdf',
    'zip',
  ]);
});
