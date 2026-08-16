import JSZip from 'jszip';

import type { NormalizedMessage } from '../../../stores/useSessionStore';
import { normalizedToChatMessages } from '../hooks/useChatMessages';
import type { ChatMessage } from '../types/types';

import {
  SESSION_EXPORT_LIMITS,
  serializeSessionExportMarkdownV1,
} from '../../../../shared/session-export-contract.js';

export type ZipExportArtifact = {
  blob: Blob;
  filename: string | null;
};

export type ZipExportExpectation = {
  sessionId: string;
  messages: readonly ChatMessage[];
  transcriptDigest: string;
};

type ZipChatPayload = {
  version: 1;
  exportedAt: string;
  transcriptDigest: string;
  metadata: { sessionId: string };
  messageCount: number;
  messages: NormalizedMessage[];
  attachments: Array<{
    exportName: string;
    sourceRef: string;
    mediaType: string | null;
    size: number;
    sha256: string;
  }>;
};

type ZipManifest = {
  version: 1;
  transcriptDigest: string;
  files: Array<{ path: string; size: number; sha256: string }>;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ATTACHMENT_NAME_PATTERN = /^([a-f0-9]{64})\.([a-z0-9]+)$/;

const COMPARABLE_MESSAGE_FIELDS = [
  'id',
  'type',
  'content',
  'displayText',
  'images',
  'files',
  'reasoning',
  'isThinking',
  'isStreaming',
  'isInteractivePrompt',
  'isToolUse',
  'toolName',
  'toolInput',
  'toolResult',
  'toolId',
  'toolCallId',
  'commandName',
  'commandMessage',
  'commandArgs',
  'isLocalCommand',
  'isLocalCommandStdout',
  'isCompactSummary',
  'isSubagentContainer',
  'isTaskNotification',
  'taskStatus',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getMediaType(response: Response): string {
  return (response.headers.get('Content-Type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function getSafeFilename(response: Response): string | null {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /(?:^|;)\s*filename="([^"]+)"/i.exec(disposition);
  const candidate = match?.[1]?.trim();
  if (!candidate
    || candidate.includes('/')
    || candidate.includes('\\')
    || /[\u0000-\u001f]/.test(candidate)
    || !candidate.toLowerCase().endsWith('.zip')) {
    return null;
  }
  return candidate;
}

function isNormalizedMessage(value: unknown, sessionId: string): value is NormalizedMessage {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && value.id.length > 0
    && value.sessionId === sessionId
    && typeof value.timestamp === 'string'
    && value.timestamp.length > 0
    && typeof value.provider === 'string'
    && value.provider.length > 0
    && typeof value.kind === 'string'
    && value.kind.length > 0;
}

function readChatPayload(value: unknown): ZipChatPayload {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    throw new Error('ZIP export contains invalid chat data.');
  }
  const metadata = value.metadata;
  if (value.version !== 1
    || typeof value.exportedAt !== 'string'
    || value.exportedAt.length === 0
    || typeof value.transcriptDigest !== 'string'
    || !SHA256_PATTERN.test(value.transcriptDigest)
    || typeof metadata.sessionId !== 'string'
    || metadata.sessionId.length === 0) {
    throw new Error('ZIP export contains invalid chat data.');
  }
  const sessionId = metadata.sessionId;
  if (typeof value.messageCount !== 'number'
    || !Number.isInteger(value.messageCount)
    || value.messageCount < 0
    || !Array.isArray(value.messages)
    || value.messageCount !== value.messages.length
    || !value.messages.every((message) => isNormalizedMessage(message, sessionId))
    || !Array.isArray(value.attachments)
    || value.attachments.length > SESSION_EXPORT_LIMITS.maxAttachmentCount) {
    throw new Error('ZIP export contains invalid chat data.');
  }

  const names = new Set<string>();
  let totalBytes = 0;
  for (const attachment of value.attachments) {
    if (!isRecord(attachment)
      || typeof attachment.exportName !== 'string'
      || !ATTACHMENT_NAME_PATTERN.test(attachment.exportName)
      || typeof attachment.sourceRef !== 'string'
      || !(attachment.mediaType === null || typeof attachment.mediaType === 'string')
      || !Number.isInteger(attachment.size)
      || (attachment.size as number) < 0
      || (attachment.size as number) > SESSION_EXPORT_LIMITS.maxAttachmentBytes
      || typeof attachment.sha256 !== 'string'
      || !SHA256_PATTERN.test(attachment.sha256)
      || !attachment.exportName.startsWith(`${attachment.sha256}.`)
      || names.has(attachment.exportName)) {
      throw new Error('ZIP export contains invalid attachment data.');
    }
    names.add(attachment.exportName);
    totalBytes += attachment.size as number;
  }
  if (totalBytes > SESSION_EXPORT_LIMITS.maxTotalAttachmentBytes) {
    throw new Error('ZIP export attachments exceed the safe size limit.');
  }

  return value as unknown as ZipChatPayload;
}

function readManifest(value: unknown): ZipManifest {
  if (!isRecord(value)
    || value.version !== 1
    || typeof value.transcriptDigest !== 'string'
    || !SHA256_PATTERN.test(value.transcriptDigest)
    || !Array.isArray(value.files)) {
    throw new Error('ZIP export contains an invalid manifest.');
  }
  const paths = new Set<string>();
  for (const file of value.files) {
    if (!isRecord(file)
      || typeof file.path !== 'string'
      || !isSafeArchivePath(file.path)
      || paths.has(file.path)
      || !Number.isInteger(file.size)
      || (file.size as number) < 0
      || typeof file.sha256 !== 'string'
      || !SHA256_PATTERN.test(file.sha256)) {
      throw new Error('ZIP export contains an invalid manifest.');
    }
    paths.add(file.path);
  }
  return value as unknown as ZipManifest;
}

function isSafeArchivePath(value: string): boolean {
  return value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw new Error('truncated ZIP metadata');
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error('truncated ZIP metadata');
  return view.getUint32(offset, true);
}

/**
 * Bounds entry count and uncompressed allocation from central-directory
 * metadata before JSZip's CRC mode inflates any entry. ZIP64, encryption,
 * duplicate names, unsafe paths, and unsupported compression are rejected.
 */
type CentralDirectoryEntry = {
  name: string;
  compressionMethod: 0 | 8;
  compressedSize: number;
  uncompressedSize: number;
  dataStart: number;
};

function validateCentralDirectoryBeforeInflation(bytes: Uint8Array): CentralDirectoryEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const minimumEocdOffset = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (readUint32(view, offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('missing ZIP central directory');

  const diskNumber = readUint16(view, eocdOffset + 4);
  const centralDisk = readUint16(view, eocdOffset + 6);
  const diskEntries = readUint16(view, eocdOffset + 8);
  const totalEntries = readUint16(view, eocdOffset + 10);
  const centralSize = readUint32(view, eocdOffset + 12);
  const centralOffset = readUint32(view, eocdOffset + 16);
  const commentLength = readUint16(view, eocdOffset + 20);
  if (diskNumber !== 0
    || centralDisk !== 0
    || diskEntries !== totalEntries
    || totalEntries > SESSION_EXPORT_LIMITS.maxAttachmentCount + 4
    || eocdOffset + 22 + commentLength !== bytes.byteLength
    || centralOffset + centralSize !== eocdOffset) {
    throw new Error('unsupported ZIP directory layout');
  }

  const names = new Set<string>();
  const entries: CentralDirectoryEntry[] = [];
  let cursor = centralOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (readUint32(view, cursor) !== centralSignature) throw new Error('invalid ZIP directory entry');
    const flags = readUint16(view, cursor + 8);
    const compressionMethod = readUint16(view, cursor + 10);
    const compressedSize = readUint32(view, cursor + 20);
    const uncompressedSize = readUint32(view, cursor + 24);
    const filenameLength = readUint16(view, cursor + 28);
    const extraLength = readUint16(view, cursor + 30);
    const entryCommentLength = readUint16(view, cursor + 32);
    const localHeaderOffset = readUint32(view, cursor + 42);
    if ((flags & 0x1) !== 0
      || (compressionMethod !== 0 && compressionMethod !== 8)
      || compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localHeaderOffset === 0xffffffff
      || uncompressedSize > SESSION_EXPORT_LIMITS.maxAttachmentBytes) {
      throw new Error('unsafe ZIP entry metadata');
    }
    const nameStart = cursor + 46;
    const nameEnd = nameStart + filenameLength;
    if (nameEnd > eocdOffset) throw new Error('truncated ZIP entry name');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(nameStart, nameEnd));
    const directory = name.endsWith('/');
    const safeFile = isSafeArchivePath(name);
    const safeDirectory = directory && name === 'attachments/';
    if ((!safeFile && !safeDirectory) || names.has(name)) {
      throw new Error('unsafe or duplicate ZIP entry');
    }
    names.add(name);
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > SESSION_EXPORT_LIMITS.maxTotalUncompressedBytes) {
      throw new Error('ZIP uncompressed size exceeds the safe limit');
    }

    if (readUint32(view, localHeaderOffset) !== 0x04034b50) {
      throw new Error('invalid ZIP local header');
    }
    const localFlags = readUint16(view, localHeaderOffset + 6);
    const localMethod = readUint16(view, localHeaderOffset + 8);
    const localNameLength = readUint16(view, localHeaderOffset + 26);
    const localExtraLength = readUint16(view, localHeaderOffset + 28);
    if (localFlags !== flags || localMethod !== compressionMethod) {
      throw new Error('ZIP local header does not match its directory entry');
    }
    const localNameStart = localHeaderOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const localName = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.slice(localNameStart, localNameEnd),
    );
    const dataStart = localNameEnd + localExtraLength;
    if (localName !== name || dataStart + compressedSize > centralOffset) {
      throw new Error('ZIP local entry is truncated or mismatched');
    }
    entries.push({
      name,
      compressionMethod: compressionMethod as 0 | 8,
      compressedSize,
      uncompressedSize,
      dataStart,
    });
    cursor = nameEnd + extraLength + entryCommentLength;
  }
  if (cursor !== eocdOffset) throw new Error('invalid ZIP directory size');
  return entries;
}

async function verifyBoundedInflation(
  bytes: Uint8Array,
  entries: CentralDirectoryEntry[],
): Promise<void> {
  let totalInflated = 0;
  for (const entry of entries) {
    if (entry.compressionMethod === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) {
        throw new Error('stored ZIP entry has inconsistent sizes');
      }
      totalInflated += entry.uncompressedSize;
      continue;
    }

    const compressed = new Uint8Array(entry.compressedSize);
    compressed.set(bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize));
    const source = new Blob([compressed.buffer]).stream();
    const inflated = source.pipeThrough(
      new DecompressionStream('deflate-raw' as CompressionFormat),
    );
    const reader = inflated.getReader();
    let entryInflated = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        entryInflated += chunk.value.byteLength;
        if (entryInflated > entry.uncompressedSize
          || entryInflated > SESSION_EXPORT_LIMITS.maxAttachmentBytes
          || totalInflated + entryInflated > SESSION_EXPORT_LIMITS.maxTotalUncompressedBytes) {
          await reader.cancel('ZIP entry exceeds its declared safe size.');
          throw new Error('ZIP entry inflated beyond its declared safe size');
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (entryInflated !== entry.uncompressedSize) {
      throw new Error('ZIP entry inflated to an unexpected size');
    }
    totalInflated += entryInflated;
  }
}

/** Reads a fetch body without ever allocating more than the supplied cap. */
export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('Response exceeds the safe archive size limit.');
        throw new Error('ZIP export exceeds the safe archive size limit.');
      }
      const copy = new Uint8Array(result.value.byteLength);
      copy.set(result.value);
      chunks.push(copy);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', copy.buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeComparableValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeComparableValue);
  if (!isRecord(value)) return value;

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = normalizeComparableValue(value[key]);
    if (item !== undefined) normalized[key] = item;
  }
  return normalized;
}

function normalizeTimestamp(value: ChatMessage['timestamp']): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function comparableMessage(message: ChatMessage): Record<string, unknown> {
  const comparable: Record<string, unknown> = {
    timestamp: normalizeTimestamp(message.timestamp),
  };
  for (const field of COMPARABLE_MESSAGE_FIELDS) {
    const value = normalizeComparableValue(message[field]);
    if (value !== undefined) comparable[field] = value;
  }

  // Child-tool timestamps may be synthesized during normalization. Compare
  // their stable transcript data while excluding that non-persisted clock.
  if (message.subagentState) {
    comparable.subagentState = {
      currentToolIndex: message.subagentState.currentToolIndex,
      isComplete: message.subagentState.isComplete,
      childTools: message.subagentState.childTools.map((tool) => ({
        toolId: tool.toolId,
        toolName: tool.toolName,
        toolInput: normalizeComparableValue(tool.toolInput),
        toolResult: normalizeComparableValue(tool.toolResult),
      })),
    };
  }

  return comparable;
}

function assertMatchesExpectedSnapshot(
  payload: ZipChatPayload,
  expected: ZipExportExpectation,
): void {
  if (payload.metadata.sessionId !== expected.sessionId) {
    throw new Error('ZIP export does not match the current conversation. Try Export again.');
  }
  if (payload.transcriptDigest !== expected.transcriptDigest) {
    throw new Error('ZIP export does not match the current conversation. Try Export again.');
  }

  const archivedMessages = normalizedToChatMessages([...payload.messages]);
  const archivedSnapshot = archivedMessages.map(comparableMessage);
  const expectedSnapshot = expected.messages.map(comparableMessage);
  if (JSON.stringify(archivedSnapshot) !== JSON.stringify(expectedSnapshot)) {
    throw new Error('ZIP export does not match the current conversation. Try Export again.');
  }
}

export async function validateZipExportResponse(
  response: Response,
  expected: ZipExportExpectation,
): Promise<ZipExportArtifact> {
  if (!response.ok) {
    throw new Error(`ZIP export failed (${response.status}).`);
  }
  if (getMediaType(response) !== 'application/zip') {
    throw new Error('ZIP export returned an unexpected content type.');
  }
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > SESSION_EXPORT_LIMITS.maxArchiveBytes) {
    throw new Error('ZIP export exceeds the safe archive size limit.');
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedResponseBytes(response, SESSION_EXPORT_LIMITS.maxArchiveBytes);
  } catch (error) {
    if (error instanceof Error && /safe archive size limit/i.test(error.message)) throw error;
    throw new Error('ZIP export response could not be read.');
  }
  if (bytes.byteLength === 0) {
    throw new Error('ZIP export returned an empty archive.');
  }
  if (bytes.byteLength > SESSION_EXPORT_LIMITS.maxArchiveBytes) {
    throw new Error('ZIP export exceeds the safe archive size limit.');
  }

  try {
    const entries = validateCentralDirectoryBeforeInflation(bytes);
    await verifyBoundedInflation(bytes, entries);
  } catch {
    throw new Error('ZIP export returned an unreadable or corrupt archive (unsafe or oversized directory metadata).');
  }

  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    throw new Error('ZIP export returned an unreadable or corrupt archive.');
  }

  const markdownEntry = archive.file('chat.md');
  const jsonEntry = archive.file('chat.json');
  const manifestEntry = archive.file('manifest.json');
  if (!markdownEntry || !jsonEntry || !manifestEntry) {
    throw new Error('ZIP export is missing required chat.md, chat.json, or manifest.json files.');
  }

  let payload: ZipChatPayload;
  let manifest: ZipManifest;
  let markdown: string;
  let json: string;
  try {
    [markdown, json] = await Promise.all([
      markdownEntry.async('string'),
      jsonEntry.async('string'),
    ]);
    payload = readChatPayload(JSON.parse(json));
    manifest = readManifest(JSON.parse(await manifestEntry.async('string')));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('ZIP export contains')) {
      throw error;
    }
    throw new Error('ZIP export contains invalid JSON metadata.');
  }
  assertMatchesExpectedSnapshot(payload, expected);

  if (manifest.transcriptDigest !== payload.transcriptDigest) {
    throw new Error('ZIP export manifest does not match the conversation snapshot.');
  }
  const derivedMarkdown = serializeSessionExportMarkdownV1(
    payload as unknown as Parameters<typeof serializeSessionExportMarkdownV1>[0],
  );
  if (markdown !== derivedMarkdown) {
    throw new Error('ZIP export contains stale or invalid Markdown.');
  }

  const expectedFiles = new Map<string, { size: number; sha256: string }>([
    ['chat.json', { size: new TextEncoder().encode(json).byteLength, sha256: await sha256Hex(json) }],
    ['chat.md', { size: new TextEncoder().encode(markdown).byteLength, sha256: await sha256Hex(markdown) }],
  ]);
  for (const attachment of payload.attachments) {
    expectedFiles.set(`attachments/${attachment.exportName}`, {
      size: attachment.size,
      sha256: attachment.sha256,
    });
  }

  const manifestFiles = new Map(manifest.files.map((file) => [file.path, file]));
  if (manifestFiles.size !== expectedFiles.size) {
    throw new Error('ZIP export manifest has an unexpected file set.');
  }
  for (const [path, expectedFile] of expectedFiles) {
    const declared = manifestFiles.get(path);
    if (!declared || declared.size !== expectedFile.size || declared.sha256 !== expectedFile.sha256) {
      throw new Error(`ZIP export manifest does not match ${path}.`);
    }
  }

  const actualFiles = Object.values(archive.files).filter((entry) => !entry.dir);
  const actualNames = actualFiles.map((entry) => entry.name);
  const expectedNames = [...expectedFiles.keys(), 'manifest.json'];
  if (actualNames.length !== expectedNames.length
    || actualNames.some((name) => !isSafeArchivePath(name) || !expectedNames.includes(name))) {
    throw new Error('ZIP export contains unexpected or unsafe files.');
  }

  for (const attachment of payload.attachments) {
    const path = `attachments/${attachment.exportName}`;
    const entry = archive.file(path);
    if (!entry) throw new Error(`ZIP export is missing ${path}.`);
    const attachmentBytes = await entry.async('uint8array');
    if (attachmentBytes.byteLength !== attachment.size
      || await sha256Hex(attachmentBytes) !== attachment.sha256) {
      throw new Error(`ZIP export contains a damaged attachment: ${path}.`);
    }
  }

  const artifactBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(artifactBuffer).set(bytes);

  return {
    blob: new Blob([artifactBuffer], { type: 'application/zip' }),
    filename: getSafeFilename(response),
  };
}

export async function downloadZipResponse(
  response: Response,
  fallbackName: string,
  expected: ZipExportExpectation,
  beforeDownload?: () => void,
): Promise<void> {
  const artifact = await validateZipExportResponse(response, expected);
  beforeDownload?.();
  const url = URL.createObjectURL(artifact.blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = artifact.filename ?? fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
