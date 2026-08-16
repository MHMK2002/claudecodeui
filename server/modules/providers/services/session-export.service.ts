import { createHash } from 'node:crypto';
import path from 'node:path';

import JSZip from 'jszip';

import { sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { AppError } from '@/shared/utils.js';
import type { FetchHistoryResult, LLMProvider, NormalizedMessage } from '@/shared/types.js';

import {
  SESSION_EXPORT_LIMITS,
  serializeTranscriptCanonicalV1,
} from '../../../../shared/session-export-contract.js';

import {
  serializeMarkdown,
  type ExportAttachment,
  type ExportMetadata,
  type ExportPayload,
} from './session-export-markdown.js';

type ExportFormat = 'zip' | 'md';

type ExportResult = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

const SUPPORTED_PROVIDERS = new Set<LLMProvider>(['claude', 'codex', 'cursor', 'opencode']);

const isSessionExportProviderSupported = (provider: LLMProvider): boolean => (
  SUPPORTED_PROVIDERS.has(provider)
);

const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
};

const extFromMediaType = (mediaType: string | null | undefined): string => {
  if (!mediaType) return 'bin';
  return MEDIA_EXTENSIONS[mediaType.toLowerCase()] ?? 'bin';
};

const slugify = (input: string, maxLength: number): string => {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= maxLength) return slug;
  return slug.slice(0, maxLength).replace(/-+$/g, '');
};

const formatTimestamp = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
};

const buildFilename = (session: { custom_name: string | null; session_id: string }, ext: string): string => {
  const base = session.custom_name?.trim() || session.session_id;
  const slug = slugify(base, 60) || 'session';
  const collision = session.session_id.slice(0, 8);
  return `${slug}-${collision}-${formatTimestamp(new Date())}.${ext}`;
};

type CollectedAttachment = ExportAttachment & { buffer: Buffer };

type ImageBlock = {
  type: 'image' | 'image_url';
  source?: { type: string; media_type?: string; data?: string };
  image_url?: { url?: string };
  mediaType?: string;
};

const extractImageBlocks = (content: unknown): ImageBlock[] => {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (b): b is ImageBlock =>
      typeof b === 'object' &&
      b !== null &&
      ((b as ImageBlock).type === 'image' || (b as ImageBlock).type === 'image_url'),
  );
};

const decodeDataUrl = (url: string): { mediaType: string; data: Buffer } | null => {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(url);
  if (!match) return null;
  return { mediaType: match[1], data: Buffer.from(match[2], 'base64') };
};

const sha256Hex = (value: string | Buffer): string => (
  createHash('sha256').update(value).digest('hex')
);

const attachmentLimitError = (message: string): AppError => new AppError(message, {
  code: 'EXPORT_ATTACHMENT_LIMIT',
  statusCode: 413,
});

const collectAttachments = (messages: ExportPayload['messages']): CollectedAttachment[] => {
  const out: CollectedAttachment[] = [];
  const seenNames = new Set<string>();
  let counter = 0;
  let totalBytes = 0;
  for (const msg of messages) {
    const blocks = extractImageBlocks((msg as { content?: unknown }).content);
    for (const block of blocks) {
      counter += 1;
      let mediaType: string | null = null;
      let buffer: Buffer | null = null;
      let sourceRef = '';

      if (block.type === 'image' && block.source?.type === 'base64' && block.source.data) {
        mediaType = block.source.media_type ?? null;
        buffer = Buffer.from(block.source.data, 'base64');
        sourceRef = `messages[${counter}].content[].source.data`;
      }
      if (!buffer && block.type === 'image_url' && typeof block.image_url?.url === 'string') {
        const url = block.image_url.url;
        if (url.startsWith('data:')) {
          const decoded = decodeDataUrl(url);
          if (decoded) {
            mediaType = decoded.mediaType;
            buffer = decoded.data;
            sourceRef = `messages[${counter}].content[].image_url.url`;
          }
        }
      }

      if (!buffer) continue;
      if (buffer.byteLength > SESSION_EXPORT_LIMITS.maxAttachmentBytes) {
        throw attachmentLimitError('An attachment is too large to include in Export.');
      }
      const digest = sha256Hex(buffer);
      const exportName = `${digest}.${extFromMediaType(mediaType)}`;
      if (seenNames.has(exportName)) continue;
      if (out.length >= SESSION_EXPORT_LIMITS.maxAttachmentCount) {
        throw attachmentLimitError('This conversation has too many attachments to export.');
      }
      totalBytes += buffer.byteLength;
      if (totalBytes > SESSION_EXPORT_LIMITS.maxTotalAttachmentBytes) {
        throw attachmentLimitError('Conversation attachments are too large to export together.');
      }
      seenNames.add(exportName);
      out.push({
        exportName,
        sourceRef,
        mediaType,
        size: buffer.byteLength,
        sha256: digest,
        buffer,
      });
    }
  }
  return out;
};

type ArchiveManifestFile = {
  path: string;
  size: number;
  sha256: string;
};

type ArchiveManifest = {
  version: 1;
  transcriptDigest: string;
  files: ArchiveManifestFile[];
};

type SessionExportRecord = {
  session_id: string;
  provider: string;
  provider_session_id: string | null;
  project_path: string | null;
  custom_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  parent_session_id: string | null;
};

type SessionExportDependencies = {
  getSessionById(sessionId: string): SessionExportRecord | null;
  fetchHistory(
    sessionId: string,
    options: { limit: null; offset: number },
  ): Promise<FetchHistoryResult>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isInteger(value) && value >= 0
);

const isExportMessage = (value: unknown, sessionId: string): value is NormalizedMessage => {
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
};

const invalidExportHistory = (): AppError => new AppError(
  'The provider returned malformed conversation history for Export.',
  { code: 'EXPORT_HISTORY_INVALID', statusCode: 502 },
);

const incompleteExportHistory = (): AppError => new AppError(
  'The complete conversation is not available for Export yet. Try again.',
  { code: 'EXPORT_HISTORY_INCOMPLETE', statusCode: 409 },
);

const invalidTranscriptDigest = (): AppError => new AppError(
  'Export requires a valid conversation snapshot digest.',
  { code: 'EXPORT_DIGEST_REQUIRED', statusCode: 400 },
);

const unavailableExportHistory = (): AppError => new AppError(
  'Conversation history could not be loaded for Export. Try again.',
  { code: 'EXPORT_HISTORY_UNAVAILABLE', statusCode: 502 },
);

/**
 * Validates the provider history response used by the providers export service.
 * A full-history request is complete only when pagination is anchored at zero,
 * has no remaining page, and its declared total matches the returned rows.
 */
const readCompleteExportHistory = (
  value: unknown,
  sessionId: string,
): FetchHistoryResult => {
  if (!isRecord(value)
    || !Array.isArray(value.messages)
    || !isNonNegativeInteger(value.total)
    || typeof value.hasMore !== 'boolean'
    || !isNonNegativeInteger(value.offset)
    || !(value.limit === null || isNonNegativeInteger(value.limit))
    || !value.messages.every((message) => isExportMessage(message, sessionId))) {
    throw invalidExportHistory();
  }

  if (value.hasMore
    || value.offset !== 0
    || value.limit !== null
    || value.total !== value.messages.length) {
    throw incompleteExportHistory();
  }

  return value as FetchHistoryResult;
};

const sanitizeFilename = (filename: string): string => {
  const base = path.basename(filename);
  return base.replace(/[\r\n"]/g, '');
};

/**
 * Builds the session-export service with injectable persistence/history ports.
 * The production singleton below consumes real Provider/Database services;
 * provider export tests inject isolated sessions to verify every provider's
 * complete ZIP payload without mutating the repository database.
 */
export function createSessionExportService(dependencies: SessionExportDependencies) {
  const buildExportPayload = async (
    sessionId: string,
    expectedTranscriptDigest: string,
  ): Promise<{ payload: ExportPayload; collected: CollectedAttachment[] }> => {
    const session = dependencies.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const provider = (session.provider ?? '') as LLMProvider;
    if (!isSessionExportProviderSupported(provider)) {
      throw new AppError(
        `Export is not supported for provider "${provider || 'unknown'}".`,
        { code: 'EXPORT_PROVIDER_UNSUPPORTED', statusCode: 400 },
      );
    }

    let fetched: unknown;
    try {
      fetched = await dependencies.fetchHistory(sessionId, { limit: null, offset: 0 });
    } catch {
      throw unavailableExportHistory();
    }
    const { messages } = readCompleteExportHistory(fetched, sessionId);
    const transcriptDigest = sha256Hex(serializeTranscriptCanonicalV1(messages));
    if (transcriptDigest !== expectedTranscriptDigest) {
      throw incompleteExportHistory();
    }
    const collected = collectAttachments(messages);
    const attachments: ExportAttachment[] = collected.map(({ buffer, ...rest }) => ({
      ...rest,
    }));

    const metadata: ExportMetadata = {
      sessionId: session.session_id,
      providerSessionId: session.provider_session_id ?? null,
      provider,
      projectPath: session.project_path ?? null,
      customName: session.custom_name ?? null,
      createdAt: session.created_at ?? null,
      updatedAt: session.updated_at ?? null,
      parentSessionId: session.parent_session_id ?? null,
    };

    const payload: ExportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      transcriptDigest,
      metadata,
      messageCount: messages.length,
      messages,
      attachments,
    };
    return { payload, collected };
  };

  const exportSession = async (
    sessionId: string,
    format: ExportFormat,
    expectedTranscriptDigest: string,
  ): Promise<ExportResult> => {
    if (!/^[a-f0-9]{64}$/.test(expectedTranscriptDigest)) {
      throw invalidTranscriptDigest();
    }
    const { payload, collected } = await buildExportPayload(sessionId, expectedTranscriptDigest);
    const session = dependencies.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (format === 'md') {
      const md = serializeMarkdown(payload);
      return {
        buffer: Buffer.from(md, 'utf8'),
        filename: buildFilename(session, 'md'),
        contentType: 'text/markdown; charset=utf-8',
      };
    }

    const zip = new JSZip();
    const markdown = serializeMarkdown(payload);
    const json = JSON.stringify(payload, null, 2);
    const manifestFiles: ArchiveManifestFile[] = [
      {
        path: 'chat.json',
        size: Buffer.byteLength(json),
        sha256: sha256Hex(json),
      },
      {
        path: 'chat.md',
        size: Buffer.byteLength(markdown),
        sha256: sha256Hex(markdown),
      },
      ...collected.map((file) => ({
        path: `attachments/${file.exportName}`,
        size: file.size,
        sha256: file.sha256,
      })),
    ];
    const manifest: ArchiveManifest = {
      version: 1,
      transcriptDigest: payload.transcriptDigest,
      files: manifestFiles,
    };

    zip.file('chat.md', markdown);
    zip.file('chat.json', json);
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    const attachmentsFolder = zip.folder('attachments');
    if (attachmentsFolder) {
      for (const file of collected) attachmentsFolder.file(file.exportName, file.buffer);
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    if (buffer.byteLength > SESSION_EXPORT_LIMITS.maxArchiveBytes) {
      throw attachmentLimitError('The generated archive is too large to download safely.');
    }
    return {
      buffer,
      filename: buildFilename(session, 'zip'),
      contentType: 'application/zip',
    };
  };

  return { exportSession, sanitizeFilename };
}

/** Provider routes consume this singleton to export real persisted histories. */
export const sessionExportService = createSessionExportService({
  getSessionById: (sessionId) => sessionsDb.getSessionById(sessionId),
  fetchHistory: (sessionId, options) => sessionsService.fetchHistory(sessionId, options),
});
