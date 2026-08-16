export type ScheduleProvider = 'claude' | 'codex' | 'cursor' | 'opencode';

export type HistoryStatus = 'running' | 'succeeded' | 'failed' | 'skipped' | 'missed';
export type RunTrigger = 'tick' | 'manual';

export interface ScheduledRun {
  id: number;
  userId: number;
  title: string;
  projectId: string | null;
  projectPath: string;
  provider: ScheduleProvider;
  providerProfileId: number | null;
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
  projectId: string;
  provider: ScheduleProvider;
  providerProfileId: number | null;
  model: string;
  prompt: string;
  cronExpression: string;
  timezone: string;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  notifyChannels?: string[] | null;
  isEnabled: boolean;
}

export type UpdateScheduledRunInput = Partial<CreateScheduledRunInput>;

export type ScheduleWorkspaceRequest = {
  requestId: number;
  schedule: ScheduledRun | null;
};
