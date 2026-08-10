import type { SubagentTranscript } from '../types/app';

export const buildSubagentRoute = (parentSessionId: string, subagentSessionId: string): string =>
  `/session/${encodeURIComponent(parentSessionId)}/subagent/${encodeURIComponent(subagentSessionId)}`;

export const resolveSubagentTranscript = (
  parentSessionId: string,
  subagentSessionId: string,
  subagents: readonly SubagentTranscript[],
): SubagentTranscript | null => (
  subagents.find((subagent) => (
    subagent.sessionId === subagentSessionId
    && subagent.parentSessionId === parentSessionId
  )) ?? null
);
