import { authenticatedFetch } from '../../utils/api';
import type { TaskSetupPlan, TaskSetupProgress, TaskSetupResult } from './types';

export class TaskSetupError extends Error {
  readonly code: string;
  readonly recovery: 'RETRY' | 'REPAIR';

  constructor(message: string, code = 'TASKMASTER_INIT_FAILED', recovery: 'RETRY' | 'REPAIR' = 'REPAIR') {
    super(message);
    this.name = 'TaskSetupError';
    this.code = code;
    this.recovery = recovery;
  }
}

async function readFailure(response: Response): Promise<TaskSetupError> {
  try {
    const payload = await response.json() as { error?: string; message?: string; recovery?: string };
    return new TaskSetupError(
      payload.message || `Task setup failed (${response.status}).`,
      payload.error,
      payload.recovery === 'RETRY' ? 'RETRY' : 'REPAIR',
    );
  } catch {
    return new TaskSetupError(`Task setup failed (${response.status}).`);
  }
}

export async function analyzeTaskSetup(
  projectId: string,
  options: { repair?: boolean; signal?: AbortSignal } = {},
): Promise<TaskSetupPlan> {
  const response = await authenticatedFetch(`/api/taskmaster/init/${encodeURIComponent(projectId)}/analyze`, {
    method: 'POST',
    body: JSON.stringify({ repair: options.repair === true }),
    signal: options.signal,
  });
  if (!response.ok) throw await readFailure(response);
  const payload = await response.json() as { success?: boolean; data?: { plan?: TaskSetupPlan } };
  if (!payload.success || !payload.data?.plan) throw new TaskSetupError('Task setup preview is unavailable.');
  return payload.data.plan;
}

export async function applyTaskSetup(
  projectId: string,
  attemptId: string,
  options: { signal?: AbortSignal; onProgress?: (progress: TaskSetupProgress) => void } = {},
): Promise<TaskSetupResult> {
  const response = await authenticatedFetch(
    `/api/taskmaster/init/${encodeURIComponent(projectId)}/attempts/${encodeURIComponent(attemptId)}/apply`,
    { method: 'POST', signal: options.signal },
  );
  if (!response.ok) throw await readFailure(response);
  if (!response.body) throw new TaskSetupError('Task setup progress stream is unavailable.', 'STREAM_UNAVAILABLE', 'RETRY');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: TaskSetupResult | null = null;
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as {
        type?: string;
        progress?: TaskSetupProgress;
        success?: boolean;
        data?: TaskSetupResult;
        error?: string;
        message?: string;
        recovery?: string;
      };
      if (event.type === 'progress' && event.progress) options.onProgress?.(event.progress);
      if (event.type === 'result' && event.success && event.data) result = event.data;
      if (event.type === 'result' && event.success === false) {
        throw new TaskSetupError(
          event.message || 'Task setup failed.',
          event.error,
          event.recovery === 'RETRY' ? 'RETRY' : 'REPAIR',
        );
      }
    }
    if (chunk.done) break;
  }
  if (!result) throw new TaskSetupError('Task setup ended without a result.', 'RESULT_MISSING', 'RETRY');
  return result;
}

export async function cancelTaskSetup(projectId: string, attemptId: string): Promise<boolean> {
  const response = await authenticatedFetch(
    `/api/taskmaster/init/${encodeURIComponent(projectId)}/attempts/${encodeURIComponent(attemptId)}`,
    { method: 'DELETE' },
  );
  return response.ok;
}
