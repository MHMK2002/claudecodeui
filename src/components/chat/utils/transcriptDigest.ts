import type { NormalizedMessage } from '../../../stores/useSessionStore';

import { serializeTranscriptCanonicalV1 } from '../../../../shared/session-export-contract.js';

/** Hashes the shared TranscriptCanonicalV1 UTF-8 bytes in Chromium or Node. */
export async function createTranscriptDigestV1(
  messages: readonly Readonly<NormalizedMessage>[],
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure transcript hashing is unavailable in this runtime.');
  const bytes = new TextEncoder().encode(serializeTranscriptCanonicalV1(messages));
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
