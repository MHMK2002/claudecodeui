import type { SessionHistoryResult } from '../../../stores/useSessionStore';
import type { ChatMessage } from '../types/types';
import { normalizedToChatMessages } from '../hooks/useChatMessages';

import { isCompleteSessionHistorySnapshot } from './sessionHistory';
import { createTranscriptDigestV1 } from './transcriptDigest';

type FullHistoryFetcher = (
  sessionId: string,
  options: { limit: null; offset: number },
) => Promise<SessionHistoryResult>;

/**
 * Hydrates the full shared session slot before any browser-local export.
 * Failed history transport aborts the export; partial cached pages are never
 * mislabeled as a complete transcript.
 */
export async function hydrateSessionMessagesForExport(
  fetchHistory: FullHistoryFetcher,
  sessionId: string,
  getRevision: () => number,
  createDigest: typeof createTranscriptDigestV1 = createTranscriptDigestV1,
): Promise<{ messages: ChatMessage[]; transcriptDigest: string; snapshotRevision: number }> {
  const result = await fetchHistory(sessionId, { limit: null, offset: 0 });
  if (!result.ok) throw new Error(result.error);
  if (!result.applied || result.superseded) {
    throw new Error('Conversation history changed while Export was loading. Try Export again.');
  }
  if (!isCompleteSessionHistorySnapshot(result.snapshot)) {
    throw new Error('Export requires the complete conversation. Try Export again.');
  }

  // Never read the mutable slot here: another page or refresh may update it
  // after this request resolves but before format generation consumes rows.
  const canonicalMessages = [...result.snapshot.merged];
  // Capture synchronously with the immutable request snapshot, before digest
  // calculation yields. A realtime event during SHA-256 must therefore make
  // the caller's final revision comparison fail instead of blessing stale data.
  const snapshotRevision = getRevision();
  return {
    messages: normalizedToChatMessages(canonicalMessages),
    transcriptDigest: await createDigest(canonicalMessages),
    snapshotRevision,
  };
}
