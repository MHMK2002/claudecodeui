import assert from 'node:assert/strict';
import test from 'node:test';

import JSZip from 'jszip';

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import type { ChatMessage } from '../types/types';

import { serializeSessionExportMarkdownV1 } from '../../../../shared/session-export-contract.js';

import {
  downloadZipResponse,
  readBoundedResponseBytes,
  validateZipExportResponse,
  type ZipExportExpectation,
} from './zipExport';

const SESSION_ID = 'session-1';
const TIMESTAMP = '2026-08-16T00:00:00.000Z';
const TRANSCRIPT_DIGEST = 'd'.repeat(64);

function createNormalizedMessage(content: string): NormalizedMessage {
  return {
    id: 'message-1',
    sessionId: SESSION_ID,
    timestamp: TIMESTAMP,
    provider: 'codex',
    kind: 'text',
    role: 'user',
    content,
  };
}

function createExpected(content: string = 'Canonical current message'): ZipExportExpectation {
  const message: ChatMessage = {
    id: 'message-1',
    type: 'user',
    content,
    timestamp: TIMESTAMP,
  };
  return { sessionId: SESSION_ID, messages: [message], transcriptDigest: TRANSCRIPT_DIGEST };
}

function createPayload(
  content: string = 'Canonical current message',
  attachments: Array<{
    exportName: string;
    sourceRef: string;
    mediaType: string | null;
    size: number;
    sha256: string;
  }> = [],
) {
  const messages = [createNormalizedMessage(content)];
  return {
    version: 1,
    exportedAt: '2026-08-16T00:01:00.000Z',
    transcriptDigest: TRANSCRIPT_DIGEST,
    metadata: {
      sessionId: SESSION_ID,
      provider: 'codex',
      customName: 'Canonical session',
      projectPath: null,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    messageCount: messages.length,
    messages,
    attachments,
  };
}

type ArchiveOptions = {
  includeMarkdown?: boolean;
  includeJson?: boolean;
  includeManifest?: boolean;
  markdown?: string;
  json?: string;
  payload?: unknown;
  manifest?: unknown;
  attachmentFiles?: Record<string, Uint8Array>;
  compression?: 'STORE' | 'DEFLATE';
};

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', copy.buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createArchive(options: ArchiveOptions = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  const payload = options.payload ?? createPayload();
  const json = options.json ?? JSON.stringify(payload, null, 2);
  const markdown = options.markdown
    ?? serializeSessionExportMarkdownV1(payload as Parameters<typeof serializeSessionExportMarkdownV1>[0]);
  if (options.includeMarkdown !== false) {
    zip.file('chat.md', markdown);
  }
  if (options.includeJson !== false) {
    zip.file('chat.json', json);
  }
  for (const [path, bytes] of Object.entries(options.attachmentFiles ?? {})) {
    zip.file(path, bytes);
  }
  if (options.includeManifest !== false) {
    const attachmentFiles = await Promise.all(
      Object.entries(options.attachmentFiles ?? {}).map(async ([path, bytes]) => ({
        path,
        size: bytes.byteLength,
        sha256: await sha256Hex(bytes),
      })),
    );
    const manifest = options.manifest ?? {
      version: 1,
      transcriptDigest: TRANSCRIPT_DIGEST,
      files: [
        { path: 'chat.json', size: new TextEncoder().encode(json).byteLength, sha256: await sha256Hex(json) },
        { path: 'chat.md', size: new TextEncoder().encode(markdown).byteLength, sha256: await sha256Hex(markdown) },
        ...attachmentFiles,
      ],
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  }
  return zip.generateAsync({ type: 'uint8array', compression: options.compression ?? 'STORE' });
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

const zipResponse = (
  body: BodyInit | null,
  {
    status = 200,
    contentType = 'application/zip',
    disposition = 'attachment; filename="session.zip"',
  } = {},
) => new Response(body, {
  status,
  headers: {
    'Content-Type': contentType,
    'Content-Disposition': disposition,
  },
});

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((value, offset) => haystack[index + offset] === value)) return index;
  }
  return -1;
}

function findLastBytes(haystack: Uint8Array, needle: readonly number[]): number {
  for (let index = haystack.length - needle.length; index >= 0; index -= 1) {
    if (needle.every((value, offset) => haystack[index + offset] === value)) return index;
  }
  return -1;
}

test('ZIP validation parses a structurally valid archive before creating an artifact', async () => {
  const bytes = await createArchive();
  const artifact = await validateZipExportResponse(zipResponse(
    responseBody(bytes),
    { contentType: 'Application/Zip; charset=binary' },
  ), createExpected());

  assert.equal(artifact.blob.size, bytes.byteLength);
  assert.equal(artifact.blob.type, 'application/zip');
  assert.equal(artifact.filename, 'session.zip');

  const unsafeFilename = await validateZipExportResponse(zipResponse(
    responseBody(bytes),
    { disposition: 'attachment; filename="../outside.zip"' },
  ), createExpected());
  assert.equal(unsafeFilename.filename, null);
});

test('ZIP validation rejects a non-success response', async () => {
  const bytes = await createArchive();
  await assert.rejects(
    validateZipExportResponse(zipResponse(responseBody(bytes), { status: 500 }), createExpected()),
    /failed \(500\)/i,
  );
});

test('chunked responses are cancelled before exceeding the archive allocation cap', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2, 3, 4, 5]));
      controller.enqueue(Uint8Array.from([6, 7, 8, 9, 10]));
    },
    cancel() {
      cancelled = true;
    },
  }));

  await assert.rejects(readBoundedResponseBytes(response, 8), /safe archive size limit/i);
  assert.equal(cancelled, true);
});

test('ZIP validation rejects 200 HTML before any download can start', async () => {
  const originalCreateObjectURL = URL.createObjectURL;
  let downloadStarts = 0;
  URL.createObjectURL = () => {
    downloadStarts += 1;
    return 'blob:test';
  };
  try {
    await assert.rejects(
      downloadZipResponse(zipResponse('<!doctype html><h1>Login</h1>', {
        contentType: 'text/html; charset=utf-8',
      }), 'fallback.zip', createExpected()),
      /unexpected content type/i,
    );
    assert.equal(downloadStarts, 0);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
  }
});

test('ZIP validation rejects empty, fake-prefix, and truncated archives', async (t) => {
  await t.test('empty archive body', async () => {
    await assert.rejects(
      validateZipExportResponse(zipResponse(new Uint8Array()), createExpected()),
      /empty archive/i,
    );
  });

  await t.test('fake local-file prefix', async () => {
    await assert.rejects(
      validateZipExportResponse(zipResponse(
        Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x01]),
      ), createExpected()),
      /unreadable or corrupt archive/i,
    );
  });

  await t.test('truncated valid archive', async () => {
    const bytes = await createArchive();
    await assert.rejects(
      validateZipExportResponse(zipResponse(
        responseBody(bytes.slice(0, bytes.length - 12)),
      ), createExpected()),
      /unreadable or corrupt archive/i,
    );
  });
});

test('ZIP validation bounds uncompressed entries before CRC inflation', async () => {
  const oversizedMarkdown = '0'.repeat((25 * 1024 * 1024) + 1);
  const bytes = await createArchive({
    markdown: oversizedMarkdown,
    compression: 'DEFLATE',
  });
  assert.ok(bytes.byteLength < 1024 * 1024, 'fixture must be highly compressed');
  await assert.rejects(
    validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
    /unsafe or oversized directory metadata/i,
  );
});

test('ZIP validation rejects corrupt central-directory and CRC data', async (t) => {
  await t.test('central-directory terminator is corrupt', async () => {
    const bytes = await createArchive();
    const corrupt = Uint8Array.from(bytes);
    const endIndex = findLastBytes(corrupt, [0x50, 0x4b, 0x05, 0x06]);
    assert.notEqual(endIndex, -1);
    corrupt[endIndex] = 0x00;

    await assert.rejects(
      validateZipExportResponse(zipResponse(responseBody(corrupt)), createExpected()),
      /unreadable or corrupt archive/i,
    );
  });

  await t.test('stored entry content fails CRC verification', async () => {
    const sentinel = 'CRC-SENTINEL-CONTENT';
    const bytes = await createArchive({ markdown: sentinel });
    const corrupt = Uint8Array.from(bytes);
    const contentIndex = findBytes(corrupt, new TextEncoder().encode(sentinel));
    assert.notEqual(contentIndex, -1);
    corrupt[contentIndex] ^= 0xff;

    await assert.rejects(
      validateZipExportResponse(zipResponse(responseBody(corrupt)), createExpected()),
      /unreadable or corrupt archive/i,
    );
  });
});

test('ZIP validation requires every top-level contract file', async (t) => {
  await t.test('chat.md is absent', async () => {
    const bytes = await createArchive({ includeMarkdown: false });
    await assert.rejects(
      validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
      /missing required chat\.md, chat\.json, or manifest\.json/i,
    );
  });

  await t.test('chat.json is absent', async () => {
    const bytes = await createArchive({ includeJson: false });
    await assert.rejects(
      validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
      /missing required chat\.md, chat\.json, or manifest\.json/i,
    );
  });

  await t.test('manifest.json is absent', async () => {
    const bytes = await createArchive({ includeManifest: false });
    await assert.rejects(
      validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
      /missing required chat\.md, chat\.json, or manifest\.json/i,
    );
  });
});

test('ZIP validation rejects malformed chat.json and inconsistent payload metadata', async (t) => {
  await t.test('chat.json is not JSON', async () => {
    const bytes = await createArchive({ json: '<html>not json</html>' });
    await assert.rejects(
      validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
      /invalid JSON metadata/i,
    );
  });

  await t.test('messageCount differs from messages length', async () => {
    const payload = { ...createPayload(), messageCount: 2 };
    const bytes = await createArchive({ payload });
    await assert.rejects(
      validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
      /invalid chat data/i,
    );
  });

  await t.test('message does not belong to the declared session', async () => {
    const payload = createPayload();
    payload.messages[0] = { ...payload.messages[0], sessionId: 'other-session' };
    const bytes = await createArchive({ payload });
    await assert.rejects(
      validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
      /invalid chat data/i,
    );
  });
});

test('ZIP validation rejects stale same-count history against the canonical snapshot', async () => {
  const bytes = await createArchive({ payload: createPayload('Stale persisted message') });
  await assert.rejects(
    validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
    /does not match the current conversation/i,
  );
});

test('ZIP validation rejects valid-CRC stale Markdown', async () => {
  const bytes = await createArchive({ markdown: '# Stale but internally hashed Markdown' });
  await assert.rejects(
    validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
    /stale or invalid Markdown/i,
  );
});

test('ZIP validation requires and hashes every declared attachment', async (t) => {
  const original = new TextEncoder().encode('canonical attachment');
  const digest = await sha256Hex(original);
  const exportName = `${digest}.png`;
  const attachment = {
    exportName,
    sourceRef: 'messages[1].content[].source.data',
    mediaType: 'image/png',
    size: original.byteLength,
    sha256: digest,
  };
  const payload = createPayload('Canonical current message', [attachment]);

  await t.test('valid attachment passes', async () => {
    const bytes = await createArchive({
      payload,
      attachmentFiles: { [`attachments/${exportName}`]: original },
    });
    const artifact = await validateZipExportResponse(
      zipResponse(responseBody(bytes)),
      createExpected(),
    );
    assert.equal(artifact.blob.size, bytes.byteLength);
  });

  await t.test('declared attachment is missing', async () => {
    const bytes = await createArchive({ payload });
    await assert.rejects(
      validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
      /manifest|missing/i,
    );
  });

  await t.test('attachment bytes are altered', async () => {
    const altered = new TextEncoder().encode('altered attachment');
    const bytes = await createArchive({
      payload,
      attachmentFiles: { [`attachments/${exportName}`]: altered },
    });
    await assert.rejects(
      validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
      /manifest|damaged attachment/i,
    );
  });

  await t.test('unlisted extra file is rejected', async () => {
    const bytes = await createArchive({
      payload: createPayload(),
      attachmentFiles: { 'attachments/unlisted.bin': original },
    });
    await assert.rejects(
      validateZipExportResponse(zipResponse(responseBody(bytes)), createExpected()),
      /manifest|unexpected/i,
    );
  });
});
