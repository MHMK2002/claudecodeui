import fs from 'node:fs';
import readline from 'node:readline';

import type { LLMProvider } from '@/shared/types.js';

type JsonRecord = Record<string, unknown>;

export type SessionRewindBoundary = {
  provider: 'claude' | 'codex';
  targetMessageId: string;
  /** Claude user UUID or Codex turn id used by provider-native APIs. */
  providerTargetId: string;
  /** Inclusive provider cursor to retain. Null means rewind to an empty chat. */
  forkPointId: string | null;
};

export class SessionRewindTargetError extends Error {
  readonly code: 'REWIND_TARGET_NOT_FOUND' | 'REWIND_TARGET_AMBIGUOUS';

  constructor(
    code: 'REWIND_TARGET_NOT_FOUND' | 'REWIND_TARGET_AMBIGUOUS',
    message: string,
  ) {
    super(message);
    this.name = 'SessionRewindTargetError';
    this.code = code;
  }
}

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' ? value as JsonRecord : null;

const isVisibleCodexUserMessage = (payload: JsonRecord | null): boolean => {
  if (!payload || payload.type !== 'user_message') return false;
  if (payload.kind && payload.kind !== 'plain') return false;
  return typeof payload.message === 'string' && payload.message.trim().length > 0;
};

const matchesCodexTarget = (
  messageId: string,
  record: JsonRecord,
  turnId: string | null,
): boolean => {
  const turnMatch = /^codex_turn_(.+)$/.exec(messageId);
  if (turnMatch) {
    return Boolean(turnId && turnId === turnMatch[1]);
  }

  const timestampMatch = /^codex_ts_(\d+)$/.exec(messageId);
  if (!timestampMatch) return false;
  return Date.parse(String(record.timestamp ?? '')) === Number(timestampMatch[1]);
};

/**
 * Resolves the single canonical rewind boundary consumed by preview, rewind,
 * and edit-and-resubmit.
 *
 * Claude user rows already point at the preceding assistant UUID through
 * `parentUuid`. Codex records a `turn_context` before every turn; because
 * app-server `thread/fork.lastTurnId` is inclusive, the previous distinct turn
 * is retained and the selected prompt's turn is omitted.
 */
export async function resolveSessionRewindBoundary(
  jsonlPath: string,
  provider: LLMProvider,
  messageId: string,
): Promise<SessionRewindBoundary> {
  if (provider !== 'claude' && provider !== 'codex') {
    throw new SessionRewindTargetError(
      'REWIND_TARGET_NOT_FOUND',
      `Provider "${provider}" does not support message rewind.`,
    );
  }

  const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let currentCodexTurnId: string | null = null;
  let previousCodexTurnId: string | null = null;
  let visibleUsersInCurrentTurn = 0;

  try {
    for await (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      let record: JsonRecord;
      try {
        record = JSON.parse(trimmed) as JsonRecord;
      } catch {
        continue;
      }

      if (provider === 'claude') {
        if (record.uuid !== messageId || record.isMeta === true) continue;
        const message = asRecord(record.message);
        if (message?.role !== 'user') continue;
        return {
          provider,
          targetMessageId: messageId,
          providerTargetId: messageId,
          forkPointId: typeof record.parentUuid === 'string' && record.parentUuid
            ? record.parentUuid
            : null,
        };
      }

      if (record.type === 'turn_context') {
        const payload = asRecord(record.payload);
        const nextTurnId = typeof payload?.turn_id === 'string' ? payload.turn_id : null;
        if (nextTurnId && nextTurnId !== currentCodexTurnId) {
          previousCodexTurnId = currentCodexTurnId;
          currentCodexTurnId = nextTurnId;
          visibleUsersInCurrentTurn = 0;
        }
        continue;
      }

      const payload = asRecord(record.payload);
      if (record.type !== 'event_msg' || !isVisibleCodexUserMessage(payload)) {
        continue;
      }
      visibleUsersInCurrentTurn += 1;
      if (!matchesCodexTarget(messageId, record, currentCodexTurnId)) {
        continue;
      }
      if (!currentCodexTurnId || visibleUsersInCurrentTurn > 1) {
        throw new SessionRewindTargetError(
          'REWIND_TARGET_AMBIGUOUS',
          'This Codex message is an in-turn steer and cannot be rewound independently.',
        );
      }
      return {
        provider,
        targetMessageId: messageId,
        providerTargetId: currentCodexTurnId,
        forkPointId: previousCodexTurnId,
      };
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  throw new SessionRewindTargetError(
    'REWIND_TARGET_NOT_FOUND',
    `Message "${messageId}" was not found in this session's transcript.`,
  );
}
