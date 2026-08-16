import type { LLMProvider } from '../types/app';

import type { MessageKind, NormalizedMessage } from './useSessionStore';

export type SessionHistoryDecodeErrorCode =
  | 'http'
  | 'content-type'
  | 'invalid-json'
  | 'invalid-envelope'
  | 'invalid-data'
  | 'invalid-message';

export type DecodedSessionHistory = {
  messages: NormalizedMessage[];
  total: number;
  hasMore: boolean;
  tokenUsage?: unknown;
};

export type SessionHistoryDecodeResult =
  | { ok: true; data: DecodedSessionHistory }
  | { ok: false; code: SessionHistoryDecodeErrorCode; error: string };

const PROVIDERS = new Set<LLMProvider>(['claude', 'cursor', 'codex', 'opencode']);

const MESSAGE_KINDS = new Set<MessageKind>([
  'text',
  'tool_use',
  'tool_result',
  'thinking',
  'stream_delta',
  'stream_end',
  'error',
  'complete',
  'status',
  'permission_request',
  'permission_cancelled',
  'session_created',
  'interactive_prompt',
  'task_notification',
]);

const OPTIONAL_STRING_FIELDS = [
  'content',
  'displayText',
  'commandName',
  'commandMessage',
  'commandArgs',
  'toolName',
  'toolId',
  'text',
  'requestId',
  'newSessionId',
  'status',
  'summary',
  'actualSessionId',
  'parentToolUseId',
] as const;

const OPTIONAL_BOOLEAN_FIELDS = [
  'isLocalCommand',
  'isLocalCommandStdout',
  'isCompactSummary',
  'isError',
  'canInterrupt',
  'isFinal',
] as const;

const OPTIONAL_NUMBER_FIELDS = [
  'seq',
  'tokens',
  'exitCode',
  'sequence',
  'rowid',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasSafeOptionalFields(value: Record<string, unknown>): boolean {
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return false;
  }
  for (const field of OPTIONAL_BOOLEAN_FIELDS) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') return false;
  }
  for (const field of OPTIONAL_NUMBER_FIELDS) {
    if (value[field] !== undefined && !Number.isFinite(value[field])) return false;
  }
  if (value.role !== undefined && value.role !== 'user' && value.role !== 'assistant') return false;
  if (value.images !== undefined && !Array.isArray(value.images)) return false;
  if (value.files !== undefined && !Array.isArray(value.files)) return false;
  if (value.subagentTools !== undefined && !Array.isArray(value.subagentTools)) return false;
  if (value.toolResult !== undefined && value.toolResult !== null) {
    if (!isRecord(value.toolResult)) return false;
    if (typeof value.toolResult.content !== 'string') return false;
    if (typeof value.toolResult.isError !== 'boolean') return false;
  }
  return true;
}

function isNormalizedMessage(
  value: unknown,
  expectedSessionId: string,
): value is NormalizedMessage {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (value.sessionId !== expectedSessionId) return false;
  if (!isNonEmptyString(value.timestamp) || !Number.isFinite(Date.parse(value.timestamp))) return false;
  if (typeof value.provider !== 'string' || !PROVIDERS.has(value.provider as LLMProvider)) return false;
  if (typeof value.kind !== 'string' || !MESSAGE_KINDS.has(value.kind as MessageKind)) return false;
  return hasSafeOptionalFields(value);
}

function readJsonMediaType(response: Response): string | null {
  const contentType = response.headers.get('content-type');
  if (!contentType) return null;
  return contentType.split(';', 1)[0]?.trim().toLowerCase() || null;
}

function isJsonCompatibleMediaType(mediaType: string | null): boolean {
  return mediaType !== null
    && /^(?:application|text)\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/i.test(mediaType);
}

/**
 * Decodes the one supported REST history contract.
 *
 * Status and media type are checked before parsing so an HTML fallback can
 * never leak a low-level `Unexpected token '<'` error into Chat.
 */
export async function decodeSessionHistoryResponse(
  response: Response,
  expectedSessionId: string,
): Promise<SessionHistoryDecodeResult> {
  if (!response.ok) {
    return {
      ok: false,
      code: 'http',
      error: `Conversation history request failed with HTTP ${response.status}.`,
    };
  }

  const mediaType = readJsonMediaType(response);
  if (!isJsonCompatibleMediaType(mediaType)) {
    return {
      ok: false,
      code: 'content-type',
      error: 'Conversation history returned a non-JSON response.',
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      code: 'invalid-json',
      error: 'Conversation history returned invalid JSON.',
    };
  }

  if (!isRecord(body) || body.success !== true || !isRecord(body.data)) {
    return {
      ok: false,
      code: 'invalid-envelope',
      error: 'Conversation history returned an invalid response envelope.',
    };
  }

  const { messages, total, hasMore, tokenUsage } = body.data;
  if (
    !Array.isArray(messages)
    || !Number.isInteger(total)
    || (total as number) < 0
    || messages.length > (total as number)
    || typeof hasMore !== 'boolean'
  ) {
    return {
      ok: false,
      code: 'invalid-data',
      error: 'Conversation history returned invalid pagination data.',
    };
  }

  if (!messages.every((message) => isNormalizedMessage(message, expectedSessionId))) {
    return {
      ok: false,
      code: 'invalid-message',
      error: 'Conversation history returned an invalid message.',
    };
  }

  return {
    ok: true,
    data: {
      messages,
      total: total as number,
      hasMore,
      ...(Object.prototype.hasOwnProperty.call(body.data, 'tokenUsage') ? { tokenUsage } : {}),
    },
  };
}
