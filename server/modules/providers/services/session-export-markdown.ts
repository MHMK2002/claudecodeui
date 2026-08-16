import type { NormalizedMessage } from '@/shared/types.js';

import { serializeSessionExportMarkdownV1 } from '../../../../shared/session-export-contract.js';

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
  size: number;
  sha256: string;
};

export type ExportPayload = {
  version: 1;
  exportedAt: string;
  transcriptDigest: string;
  metadata: ExportMetadata;
  messageCount: number;
  messages: NormalizedMessage[];
  attachments: ExportAttachment[];
};

/** Providers export service uses the shared V1 projection so browser validation cannot drift. */
export const serializeMarkdown = (payload: ExportPayload): string => (
  serializeSessionExportMarkdownV1(payload as Parameters<typeof serializeSessionExportMarkdownV1>[0])
);
