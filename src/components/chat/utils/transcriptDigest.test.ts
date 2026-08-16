import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedMessage } from '../../../stores/useSessionStore';

import {
  serializeSessionExportMarkdownV1,
  serializeTranscriptCanonicalV1,
} from '../../../../shared/session-export-contract.js';

import { createTranscriptDigestV1 } from './transcriptDigest';

const vector: NormalizedMessage[] = [
  {
    id: 'm1',
    sessionId: 's1',
    timestamp: '2026-08-16T00:00:00.000Z',
    provider: 'codex',
    kind: 'tool_use',
    toolId: 't1',
    toolName: 'shell',
    toolInput: { z: 2, a: 'سلام' },
  },
  {
    id: 'm2',
    sessionId: 's1',
    timestamp: '2026-08-16T00:00:01.000Z',
    provider: 'codex',
    kind: 'tool_result',
    toolId: 't1',
    content: 'ok',
    isError: false,
    seq: 9,
  },
];

test('TranscriptCanonicalV1 has one stable cross-runtime golden vector', async () => {
  assert.equal(
    serializeTranscriptCanonicalV1(vector),
    '{"messages":[{"id":"m1","kind":"tool_use","provider":"codex","sessionId":"s1","timestamp":"2026-08-16T00:00:00.000Z","toolId":"t1","toolInput":{"a":"سلام","z":2},"toolName":"shell","toolResult":{"content":"ok","isError":false}}],"version":1}',
  );
  assert.equal(
    await createTranscriptDigestV1(vector),
    '182ba9e9bdd77d98efc687a8856a9eec74264d482f55cf7e228974bbaf47dcc2',
  );
});

test('Markdown V1 renders session attachments once instead of once per message', () => {
  const digest = 'a'.repeat(64);
  const markdown = serializeSessionExportMarkdownV1({
    version: 1,
    exportedAt: '2026-08-16T00:02:00.000Z',
    transcriptDigest: digest,
    metadata: { sessionId: 's1', provider: 'codex', customName: 'Session' },
    messageCount: 2,
    messages: [
      { id: 'm1', sessionId: 's1', timestamp: '2026-08-16T00:00:00.000Z', provider: 'codex', kind: 'text', role: 'user', content: 'one' },
      { id: 'm2', sessionId: 's1', timestamp: '2026-08-16T00:00:01.000Z', provider: 'codex', kind: 'text', role: 'assistant', content: 'two' },
    ],
    attachments: [{
      exportName: `${digest}.png`,
      sourceRef: 'messages[0].content[]',
      mediaType: 'image/png',
      size: 1,
      sha256: digest,
    }],
  });

  assert.equal(markdown.split('## Attachments').length - 1, 1);
  assert.equal(markdown.split(`attachments/${digest}.png`).length - 1, 1);
});
