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
};

/**
 * Shared terminal path for batch and streaming STT. Delivers the raw transcript
 * through a single delivery callback for one committed recording. Text polishing
 * is now an on-demand user action (Enhance), not part of this pipeline.
 */
export async function finalizeVoiceTranscript({
  rawText,
  send,
  origin,
  signal,
  ownsUi,
  onTranscript,
}: FinalizeVoiceTranscriptOptions): Promise<VoiceTranscriptFinalizationResult> {
  if (!rawText.trim()) return 'empty';
  if (signal?.aborted) return 'cancelled';

  await onTranscript(rawText, send, origin, { ownsUi: ownsUi?.() ?? true });
  return 'delivered';
}
