import type { NormalizedMessage } from '@/shared/types.js';

export type ExportMetadata = {
  sessionId: string;
  providerSessionId: string | null;
  provider: string;
  projectPath: string | null;
  customName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  parentSessionId: string | null;
};

export type ExportAttachment = {
  exportName: string;
  sourceRef: string;
  mediaType: string | null;
};

export type ExportPayload = {
  version: 1;
  exportedAt: string;
  metadata: ExportMetadata;
  messageCount: number;
  messages: NormalizedMessage[];
  attachments: ExportAttachment[];
};

const MAX_TOOL_OUTPUT_BYTES = 4 * 1024;

const formatTimestamp = (raw: string | number | Date | null | undefined): string => {
  if (raw === null || raw === undefined) return '';
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toISOString();
};

const truncate = (text: string, maxBytes: number): string => {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  return `${buf.subarray(0, maxBytes).toString('utf8')}\n\n[... truncated ${buf.length - maxBytes} bytes ...]`;
};

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const renderContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: Record<string, unknown>) => {
        if (block?.type === 'text' && typeof block.text === 'string') return block.text;
        if (block?.type === 'image' || block?.type === 'image_url') return '';
        return safeJson(block);
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return safeJson(content);
};

const renderAttachments = (attachments: ExportAttachment[]): string => {
  if (attachments.length === 0) return '';
  const lines = attachments.map((a) => `- ![](${a.exportName}) _(${a.mediaType ?? 'unknown'})_`);
  return `\n\nAttachments:\n${lines.join('\n')}\n`;
};

export const serializeMarkdown = (payload: ExportPayload): string => {
  const { metadata, messages, attachments, exportedAt } = payload;
  const title = metadata.customName?.trim() || metadata.sessionId;
  const parts: string[] = [];

  parts.push(`# ${title}`);
  parts.push(
    `*Provider: ${metadata.provider} · Session: ${metadata.sessionId} · Messages: ${payload.messageCount}*`,
  );
  if (metadata.projectPath) parts.push(`*Project: ${metadata.projectPath}*`);
  if (metadata.createdAt) parts.push(`*Created: ${metadata.createdAt}*`);
  if (metadata.updatedAt) parts.push(`*Updated: ${metadata.updatedAt}*`);
  parts.push(`*Exported: ${exportedAt}*`);
  parts.push('\n---\n');

  for (const msg of messages) {
    const ts = formatTimestamp((msg as { timestamp?: string | number | Date }).timestamp);
    const kind = msg.kind;

    if (kind === 'text' || kind === 'error' || kind === 'thinking') {
      const label =
        kind === 'thinking'
          ? 'Thinking'
          : kind === 'error'
            ? 'Error'
            : msg.role === 'user'
              ? 'User'
              : 'Assistant';
      parts.push(`## ${label}${ts ? ` — ${ts}` : ''}`);
      parts.push('');
      parts.push(renderContent((msg as { content?: unknown }).content));
      parts.push(renderAttachments(attachments));
      parts.push('');
    } else if (kind === 'tool_use') {
      const toolName = (msg as { toolName?: string }).toolName ?? 'tool';
      parts.push(`### Tool: ${toolName}${ts ? ` — ${ts}` : ''}`);
      parts.push('');
      parts.push('```json');
      parts.push(safeJson((msg as { toolInput?: unknown }).toolInput));
      parts.push('```');
      parts.push('');
    } else if (kind === 'tool_result') {
      const output = (msg as { output?: unknown }).output;
      const text = typeof output === 'string' ? output : safeJson(output);
      parts.push('### Tool result');
      parts.push('');
      parts.push(truncate(text, MAX_TOOL_OUTPUT_BYTES));
      parts.push('');
    } else if (kind === 'interactive_prompt') {
      parts.push(`### Interactive prompt${ts ? ` — ${ts}` : ''}`);
      parts.push('');
      parts.push(renderContent((msg as { content?: unknown }).content));
      parts.push('');
    } else if (kind === 'task_notification') {
      const status = (msg as { status?: string }).status ?? 'completed';
      const summary = (msg as { summary?: string }).summary ?? '';
      parts.push(`### Task notification (${status})${ts ? ` — ${ts}` : ''}`);
      if (summary) {
        parts.push('');
        parts.push(summary);
      }
      parts.push('');
    } else {
      parts.push(`### ${kind ?? 'message'}${ts ? ` — ${ts}` : ''}`);
      parts.push('');
      parts.push(safeJson(msg));
      parts.push('');
    }
  }

  if (messages.length === 0) {
    parts.push('_No messages in this session yet._\n');
  }

  return parts.join('\n');
};