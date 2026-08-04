export type VoiceTranscriptFinalizationResult = 'delivered' | 'empty' | 'cancelled';
export type VoiceTranscriptDelivery = { ownsUi: boolean };

export type FinalizeVoiceTranscriptOptions = {
  rawText: string;
  send: boolean;
  origin?: unknown;
  signal?: AbortSignal;
  ownsUi?: () => boolean;
  onTranscript: (
    text: string,
    send?: boolean,
    origin?: unknown,
    delivery?: VoiceTranscriptDelivery,
  ) => void | Promise<void>;
  cleanup: (text: string, options: { signal?: AbortSignal }) => Promise<string>;
};

/**
 * Shared terminal path for batch and streaming STT. It owns the single cleanup
 * attempt and the single delivery callback for one committed recording.
 */
export async function finalizeVoiceTranscript({
  rawText,
  send,
  origin,
  signal,
  ownsUi,
  onTranscript,
  cleanup,
}: FinalizeVoiceTranscriptOptions): Promise<VoiceTranscriptFinalizationResult> {
  if (!rawText.trim()) return 'empty';
  if (signal?.aborted) return 'cancelled';

  const finalText = await cleanup(rawText, { signal });
  if (signal?.aborted) return 'cancelled';

  await onTranscript(finalText, send, origin, { ownsUi: ownsUi?.() ?? true });
  return 'delivered';
}
