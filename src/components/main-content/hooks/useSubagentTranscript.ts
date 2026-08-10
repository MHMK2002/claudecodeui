import { useEffect, useState } from 'react';

import type { SubagentTranscript } from '../../../types/app';
import { api } from '../../../utils/api';
import { resolveSubagentTranscript } from '../../../utils/subagentNavigation';

type SubagentTranscriptState = {
  status: 'idle' | 'loading' | 'ready' | 'not-found' | 'error';
  transcript: SubagentTranscript | null;
};

const IDLE_STATE: SubagentTranscriptState = { status: 'idle', transcript: null };

export function useSubagentTranscript(
  parentSessionId: string | null,
  subagentSessionId: string | null,
): SubagentTranscriptState {
  const [state, setState] = useState<SubagentTranscriptState>(IDLE_STATE);

  useEffect(() => {
    if (!parentSessionId || !subagentSessionId) {
      setState(IDLE_STATE);
      return;
    }

    let cancelled = false;
    setState({ status: 'loading', transcript: null });

    const loadTranscript = async () => {
      try {
        const response = await api.sessionSubagents(parentSessionId);
        if (!response.ok) {
          throw new Error(`Failed to load subagents: ${response.status}`);
        }

        const payload = await response.json();
        const subagents = Array.isArray(payload?.data?.subagents)
          ? payload.data.subagents as SubagentTranscript[]
          : [];
        const transcript = resolveSubagentTranscript(
          parentSessionId,
          subagentSessionId,
          subagents,
        );

        if (!cancelled) {
          setState(transcript
            ? { status: 'ready', transcript }
            : { status: 'not-found', transcript: null });
        }
      } catch (error) {
        console.error(
          `[MainContent] Failed to load subagent ${subagentSessionId} for ${parentSessionId}:`,
          error,
        );
        if (!cancelled) {
          setState({ status: 'error', transcript: null });
        }
      }
    };

    void loadTranscript();
    return () => {
      cancelled = true;
    };
  }, [parentSessionId, subagentSessionId]);

  return state;
}
