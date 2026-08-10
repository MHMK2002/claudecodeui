export type ScheduleProvider = 'claude' | 'codex' | 'cursor' | 'opencode';

export type HistoryStatus = 'running' | 'succeeded' | 'failed' | 'skipped';
export type RunTrigger = 'tick' | 'manual';

export interface ScheduledRun {
  id: number;
  userId: number;
  title: string;
  projectPath: string;
  provider: ScheduleProvider;
  model: string;
  prompt: string;
  cronExpression: string;
  timezone: string;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  notifyChannels: string[] | null;
  isEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  inFlightRunId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledRunHistory {
  id: number;
  scheduleId: number;
  status: HistoryStatus;
  trigger: RunTrigger;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  outputSummary: string | null;
  errorMessage: string | null;
}

export interface CreateScheduledRunInput {
  title: string;
  projectPath: string;
  provider: ScheduleProvider;
  model: string;
  prompt: string;
  cronExpression: string;
  timezone: string;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  notifyChannels?: string[] | null;
  isEnabled: boolean;
}

export interface UpdateScheduledRunInput extends Partial<CreateScheduledRunInput> {}
