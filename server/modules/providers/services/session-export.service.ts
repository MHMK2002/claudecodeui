import { createHash } from 'node:crypto';
import path from 'node:path';

import JSZip from 'jszip';

import { sessionsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { AppError } from '@/shared/utils.js';
import type { LLMProvider } from '@/shared/types.js';

import {
  serializeMarkdown,
  type ExportAttachment,
  type ExportMetadata,
  type ExportPayload,
} from './session-export-markdown.js';

export type ExportFormat = 'zip' | 'md';

export type ExportResult = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

const SUPPORTED_PROVIDERS: LLMProvider[] = ['claude', 'codex'];

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

const collectAttachments = (messages: ExportPayload['messages']): CollectedAttachment[] => {
  const out: CollectedAttachment[] = [];
  let counter = 0;
  for (const msg of messages) {
    const blocks = extractImageBlocks((msg as { content?: unknown }).content);
    for (const block of blocks) {
      counter += 1;
      const name = `img-${String(counter).padStart(3, '0')}`;

      if (block.type === 'image' && block.source?.type === 'base64' && block.source.data) {
        const mediaType = block.source.media_type ?? null;
        const buffer = Buffer.from(block.source.data, 'base64');
        out.push({
          exportName: `${name}.${extFromMediaType(mediaType)}`,
          sourceRef: `messages[${counter}].content[].source.data`,
          mediaType,
          buffer,
        });
        continue;
      }
      if (block.type === 'image_url' && typeof block.image_url?.url === 'string') {
        const url = block.image_url.url;
        if (url.startsWith('data:')) {
          const decoded = decodeDataUrl(url);
          if (decoded) {
            out.push({
              exportName: `${name}.${extFromMediaType(decoded.mediaType)}`,
              sourceRef: `messages[${counter}].content[].image_url.url`,
              mediaType: decoded.mediaType,
              buffer: decoded.data,
            });
          }
        }
      }
    }
  }
  return out;
};

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex').slice(0, 12);

export const buildExportPayload = async (sessionId: string): Promise<ExportPayload> => {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    throw new AppError(`Session "${sessionId}" was not found.`, {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }

  const provider = (session.provider ?? '') as LLMProvider;
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new AppError(
      `Export is currently supported for Claude and Codex only (this session uses "${provider || 'unknown'}").`,
      { code: 'EXPORT_PROVIDER_UNSUPPORTED', statusCode: 400 },
    );
  }

  const fetched = await sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 });
  const messages = Array.isArray(fetched?.messages) ? fetched.messages : [];

  const collected = collectAttachments(messages);
  const attachments: ExportAttachment[] = collected.map(({ buffer, ...rest }) => ({
    ...rest,
    sourceRef: `${rest.sourceRef}#sha256:${sha256(buffer)}`,
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

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    metadata,
    messageCount: messages.length,
    messages,
    attachments,
  };
};

export const exportSession = async (
  sessionId: string,
  format: ExportFormat,
): Promise<ExportResult> => {
  const payload = await buildExportPayload(sessionId);
  const session = sessionsDb.getSessionById(sessionId);
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
  zip.file('chat.md', serializeMarkdown(payload));
  zip.file('chat.json', JSON.stringify(payload, null, 2));
  const attachmentsFolder = zip.folder('attachments');
  if (attachmentsFolder) {
    const collected = collectAttachments(payload.messages);
    for (const file of collected) {
      attachmentsFolder.file(file.exportName, file.buffer);
    }
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    buffer,
    filename: buildFilename(session, 'zip'),
    contentType: 'application/zip',
  };
};

export const sanitizeFilename = (filename: string): string => {
  const base = path.basename(filename);
  return base.replace(/[\r\n"]/g, '');
};

/**
 * Builds downloadable session transcripts (Markdown or zip bundle) for export.
 */
export const sessionExportService = {
  buildExportPayload,
  exportSession,
  sanitizeFilename,
};