export const SESSION_EXPORT_LIMITS: Readonly<{
  maxAttachmentCount: number;
  maxAttachmentBytes: number;
  maxTotalAttachmentBytes: number;
  maxTotalUncompressedBytes: number;
  maxArchiveBytes: number;
}>;

export type SessionExportAttachmentV1 = {
  exportName: string;
  sourceRef: string;
  mediaType: string | null;
  size: number;
  sha256: string;
};

export type SessionExportPayloadV1 = {
  version: 1;
  exportedAt: string;
  transcriptDigest: string;
  metadata: Record<string, unknown> & {
    sessionId: string;
    provider?: string;
    customName?: string | null;
  };
  messageCount: number;
  messages: Array<Record<string, unknown>>;
  attachments: SessionExportAttachmentV1[];
};

export function createTranscriptCanonicalV1(messages: readonly unknown[]): unknown;
export function serializeTranscriptCanonicalV1(messages: readonly unknown[]): string;
export function serializeSessionExportMarkdownV1(payload: SessionExportPayloadV1): string;
