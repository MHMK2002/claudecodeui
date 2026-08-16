const TRANSCRIPT_CANONICAL_VERSION = 1;

export const SESSION_EXPORT_LIMITS = Object.freeze({
  maxAttachmentCount: 32,
  maxAttachmentBytes: 25 * 1024 * 1024,
  maxTotalAttachmentBytes: 100 * 1024 * 1024,
  maxTotalUncompressedBytes: 105 * 1024 * 1024,
  maxArchiveBytes: 120 * 1024 * 1024,
});

const EXPORTED_MESSAGE_KINDS = new Set([
  'text',
  'tool_use',
  'thinking',
  'error',
  'interactive_prompt',
  'task_notification',
  // A live partial response must make a persisted ZIP snapshot mismatch until
  // the provider transcript catches up.
  'stream_delta',
]);

const TRANSCRIPT_MESSAGE_FIELDS = Object.freeze([
  'id',
  'sessionId',
  'timestamp',
  'provider',
  'kind',
  'role',
  'content',
  'displayText',
  'images',
  'files',
  'reasoning',
  'commandName',
  'commandMessage',
  'commandArgs',
  'isLocalCommand',
  'isLocalCommandStdout',
  'isCompactSummary',
  'toolName',
  'toolInput',
  'toolResult',
  'toolId',
  'toolCallId',
  'isError',
  'text',
  'tokens',
  'input',
  'context',
  'reason',
  'status',
  'summary',
  'taskStatus',
  'tokenBudget',
  'subagentTools',
  'toolUseResult',
  'parentToolUseId',
  'sequence',
  'rowid',
]);

const isRecord = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

function normalizeJsonValue(value, inArray = false) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return inArray ? null : undefined;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Session transcript contains a non-finite number.');
    }
    return value;
  }
  if (typeof value === 'bigint') {
    throw new TypeError('Session transcript contains an unsupported bigint.');
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item, true));
  }
  if (!isRecord(value)) {
    throw new TypeError('Session transcript contains a non-JSON value.');
  }

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    const item = normalizeJsonValue(value[key], false);
    if (item !== undefined) normalized[key] = item;
  }
  return normalized;
}

function normalizeToolResult(message) {
  if (!isRecord(message)) return null;
  return {
    content: typeof message.content === 'string' ? message.content : '',
    isError: Boolean(message.isError),
    ...(message.toolUseResult !== undefined ? { toolUseResult: message.toolUseResult } : {}),
  };
}

/**
 * Produces the normative TranscriptCanonicalV1 JSON value.
 *
 * Message order and array order are preserved. Object keys are sorted
 * recursively, undefined object properties are omitted, undefined array
 * entries become null, strings retain their original Unicode code points, and
 * non-finite numbers/non-JSON values are rejected. Standalone tool-result rows
 * are attached to their matching tool-use row before projection. Realtime-only
 * sequence numbers and control events are intentionally excluded.
 */
export function createTranscriptCanonicalV1(messages) {
  if (!Array.isArray(messages)) {
    throw new TypeError('Session transcript must be an array.');
  }

  const toolResults = new Map();
  for (const message of messages) {
    if (
      isRecord(message)
      && message.kind === 'tool_result'
      && typeof message.toolId === 'string'
      && message.toolId.length > 0
    ) {
      toolResults.set(message.toolId, normalizeToolResult(message));
    }
  }

  const projected = [];
  for (const message of messages) {
    if (!isRecord(message) || !EXPORTED_MESSAGE_KINDS.has(message.kind)) continue;
    const row = {};
    for (const field of TRANSCRIPT_MESSAGE_FIELDS) {
      let value = message[field];
      if (
        field === 'toolResult'
        && value === undefined
        && message.kind === 'tool_use'
        && typeof message.toolId === 'string'
      ) {
        value = toolResults.get(message.toolId);
      }
      if (value !== undefined) row[field] = value;
    }
    projected.push(normalizeJsonValue(row));
  }

  return normalizeJsonValue({
    version: TRANSCRIPT_CANONICAL_VERSION,
    messages: projected,
  });
}

/** Serializes TranscriptCanonicalV1 into its exact UTF-8 hash input string. */
export function serializeTranscriptCanonicalV1(messages) {
  return JSON.stringify(createTranscriptCanonicalV1(messages));
}

function formatTimestamp(raw) {
  if (raw === null || raw === undefined) return '';
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? String(raw) : date.toISOString();
}

function truncateUtf8(text, maxBytes) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  const prefix = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, maxBytes));
  return `${prefix}\n\n[... truncated ${bytes.byteLength - maxBytes} bytes ...]`;
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block?.type === 'text' && typeof block.text === 'string') return block.text;
        if (block?.type === 'image' || block?.type === 'image_url') return '';
        return safeJson(block);
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return safeJson(content);
}

function renderAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';
  const lines = attachments.map((attachment) => (
    `- ![](attachments/${attachment.exportName}) _(${attachment.mediaType ?? 'unknown'})_`
  ));
  return `## Attachments\n\n${lines.join('\n')}\n`;
}

/**
 * Pure cross-runtime Markdown projection used by both the ZIP generator and
 * the browser validator. Any archive whose chat.md differs byte-for-byte from
 * this projection is invalid even when its CRC is otherwise sound.
 */
export function serializeSessionExportMarkdownV1(payload) {
  const metadata = payload.metadata ?? {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const title = metadata.customName?.trim() || metadata.sessionId;
  const parts = [];

  parts.push(`# ${title}`);
  parts.push(
    `*Provider: ${metadata.provider} · Session: ${metadata.sessionId} · Messages: ${payload.messageCount}*`,
  );
  if (metadata.projectPath) parts.push(`*Project: ${metadata.projectPath}*`);
  if (metadata.createdAt) parts.push(`*Created: ${metadata.createdAt}*`);
  if (metadata.updatedAt) parts.push(`*Updated: ${metadata.updatedAt}*`);
  parts.push(`*Exported: ${payload.exportedAt}*`);
  parts.push('\n---\n');

  for (const message of messages) {
    const timestamp = formatTimestamp(message.timestamp);
    const kind = message.kind;

    if (kind === 'text' || kind === 'error' || kind === 'thinking') {
      const label = kind === 'thinking'
        ? 'Thinking'
        : kind === 'error'
          ? 'Error'
          : message.role === 'user'
            ? 'User'
            : 'Assistant';
      parts.push(`## ${label}${timestamp ? ` — ${timestamp}` : ''}`);
      parts.push('');
      parts.push(renderContent(message.content));
      parts.push('');
    } else if (kind === 'tool_use') {
      parts.push(`### Tool: ${message.toolName ?? 'tool'}${timestamp ? ` — ${timestamp}` : ''}`);
      parts.push('');
      parts.push('```json');
      parts.push(safeJson(message.toolInput));
      parts.push('```');
      parts.push('');
    } else if (kind === 'tool_result') {
      const output = message.output;
      const text = typeof output === 'string' ? output : safeJson(output);
      parts.push('### Tool result');
      parts.push('');
      parts.push(truncateUtf8(text, 4 * 1024));
      parts.push('');
    } else if (kind === 'interactive_prompt') {
      parts.push(`### Interactive prompt${timestamp ? ` — ${timestamp}` : ''}`);
      parts.push('');
      parts.push(renderContent(message.content));
      parts.push('');
    } else if (kind === 'task_notification') {
      parts.push(`### Task notification (${message.status ?? 'completed'})${timestamp ? ` — ${timestamp}` : ''}`);
      if (message.summary) {
        parts.push('');
        parts.push(message.summary);
      }
      parts.push('');
    } else {
      parts.push(`### ${kind ?? 'message'}${timestamp ? ` — ${timestamp}` : ''}`);
      parts.push('');
      parts.push(safeJson(message));
      parts.push('');
    }
  }

  if (messages.length === 0) parts.push('_No messages in this session yet._\n');
  const attachmentSection = renderAttachments(attachments);
  if (attachmentSection) parts.push(attachmentSection);
  return parts.join('\n');
}
