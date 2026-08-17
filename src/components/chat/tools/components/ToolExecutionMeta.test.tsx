import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { deriveToolGroupExecution, deriveToolStatus } from '../utils/toolStatus';

import { ToolExecutionMeta } from './ToolExecutionMeta';

const TIMESTAMP = '2026-08-16T10:02:00.000Z';

test('running metadata keeps textual status, motion-safe activity, and clock time together', () => {
  const html = renderToStaticMarkup(
    <ToolExecutionMeta status="running" timestamp={TIMESTAMP} />,
  );

  assert.match(html, /data-tool-execution-meta="true"/);
  assert.match(html, />Running</);
  assert.match(html, /motion-reduce:animate-none/);
  assert.match(html, /<time [^>]*dateTime="2026-08-16T10:02:00\.000Z"/);
});

test('successful metadata shows Done beside the timestamp', () => {
  const html = renderToStaticMarkup(
    <ToolExecutionMeta status="completed" timestamp={TIMESTAMP} />,
  );

  assert.match(html, />Done</);
  assert.match(html, /<time /);
});

test('error and denied states remain explicit text beside the timestamp', () => {
  const errorHtml = renderToStaticMarkup(
    <ToolExecutionMeta status="error" timestamp={TIMESTAMP} />,
  );
  const deniedHtml = renderToStaticMarkup(
    <ToolExecutionMeta status="denied" timestamp={TIMESTAMP} />,
  );

  assert.match(errorHtml, />Error</);
  assert.match(deniedHtml, />Denied</);
  assert.match(errorHtml, /<time /);
  assert.match(deniedHtml, /<time /);
});

test('tool status derivation preserves existing truthful lifecycle states', () => {
  assert.equal(deriveToolStatus(undefined), 'running');
  assert.equal(deriveToolStatus({ content: 'ok', isError: false }), 'completed');
  assert.equal(deriveToolStatus({ content: 'boom', isError: true }), 'error');
  assert.equal(deriveToolStatus({ content: 'User denied tool use', isError: true }), 'denied');
});

test('grouped tools surface the highest-priority status and its own timestamp', () => {
  const running = deriveToolGroupExecution([
    { timestamp: '2026-08-16T10:01:00.000Z' },
    { timestamp: '2026-08-16T10:02:00.000Z', toolResult: { content: 'ok', isError: false } },
  ]);
  const failed = deriveToolGroupExecution([
    { timestamp: '2026-08-16T10:03:00.000Z', toolResult: { content: 'boom', isError: true } },
    { timestamp: '2026-08-16T10:04:00.000Z', toolResult: { content: 'User denied tool use', isError: true } },
  ]);

  assert.deepEqual(running, {
    status: 'running',
    timestamp: '2026-08-16T10:01:00.000Z',
  });
  assert.deepEqual(failed, {
    status: 'error',
    timestamp: '2026-08-16T10:03:00.000Z',
  });
});

test('grouped successful tools keep their Done status visible', () => {
  const source = readFileSync(
    'src/components/chat/view/subcomponents/ToolGroupContainer.tsx',
    'utf8',
  );

  assert.match(source, /status=\{groupExecution\.status\}/);
  assert.doesNotMatch(source, /groupExecution\.status === 'completed' \? undefined/);
});
