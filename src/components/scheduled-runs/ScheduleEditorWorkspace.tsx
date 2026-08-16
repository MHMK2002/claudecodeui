import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronDown, Clock3, Loader2 } from 'lucide-react';

import { useScheduledRuns } from '../../contexts/ScheduledRunsContext';
import { cn } from '../../lib/utils';
import {
  defaultProfileForEntry,
  isProfileProvider,
  resolveCatalogModel,
  useProviderSelectionCatalog,
  type ProviderSelectionCatalogState,
} from '../../shared/hooks/useProviderSelectionCatalog';
import type { Project } from '../../types/app';
import type { ScheduleProvider, ScheduledRun } from '../../types/scheduledRuns';
import { nextCronRuns, validateCron } from '../../utils/cron';

type ScheduleEditorWorkspaceProps = {
  project: Project;
  editingSchedule: ScheduledRun | null;
  onClose: () => void;
  onOpenAgentSettings: () => void;
};

type ScheduleEditorWorkspaceViewProps = ScheduleEditorWorkspaceProps & {
  scheduleActions: Pick<ReturnType<typeof useScheduledRuns>, 'create' | 'update' | 'runNow'>;
  catalogState: ProviderSelectionCatalogState;
};

type ScheduleMode = 'daily' | 'weekly' | 'custom';
type SaveState = 'idle' | 'saving' | 'failed';

const WEEKDAYS = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 0, short: 'Sun', label: 'Sunday' },
] as const;

function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function parseSimpleSchedule(cronExpression: string): {
  mode: ScheduleMode;
  time: string;
  weeklyDay: number;
  customDays: number[];
  advanced: boolean;
} {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpression.trim().split(/\s+/);
  const minuteValue = Number.parseInt(minute, 10);
  const hourValue = Number.parseInt(hour, 10);
  const validTime = /^\d+$/.test(minute ?? '')
    && /^\d+$/.test(hour ?? '')
    && minuteValue >= 0
    && minuteValue <= 59
    && hourValue >= 0
    && hourValue <= 23;
  const time = validTime
    ? `${String(hourValue).padStart(2, '0')}:${String(minuteValue).padStart(2, '0')}`
    : '08:00';
  if (!validTime || dayOfMonth !== '*' || month !== '*') {
    return { mode: 'custom', time, weeklyDay: 1, customDays: [1, 2, 3, 4, 5], advanced: true };
  }
  if (dayOfWeek === '*') {
    return { mode: 'daily', time, weeklyDay: 1, customDays: [1, 2, 3, 4, 5], advanced: false };
  }
  if (/^[0-7]$/.test(dayOfWeek)) {
    const normalizedDay = Number(dayOfWeek) === 7 ? 0 : Number(dayOfWeek);
    return { mode: 'weekly', time, weeklyDay: normalizedDay, customDays: [normalizedDay], advanced: false };
  }
  const customDays = dayOfWeek
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .map((value) => value === 7 ? 0 : value)
    .filter((value, index, all) => value >= 0 && value <= 6 && all.indexOf(value) === index);
  if (customDays.length > 0 && dayOfWeek.split(',').every((value) => /^[0-7]$/.test(value))) {
    return { mode: 'custom', time, weeklyDay: customDays[0], customDays, advanced: false };
  }
  return { mode: 'custom', time, weeklyDay: 1, customDays: [1, 2, 3, 4, 5], advanced: true };
}

function cronForSchedule(mode: ScheduleMode, time: string, weeklyDay: number, customDays: number[]): string {
  const [hour = '8', minute = '0'] = time.split(':');
  const normalizedHour = Number.parseInt(hour, 10);
  const normalizedMinute = Number.parseInt(minute, 10);
  if (mode === 'daily') return `${normalizedMinute} ${normalizedHour} * * *`;
  if (mode === 'weekly') return `${normalizedMinute} ${normalizedHour} * * ${weeklyDay}`;
  const days = [...customDays].sort((left, right) => left - right).join(',');
  return `${normalizedMinute} ${normalizedHour} * * ${days || '1'}`;
}

/** Main-workspace schedule editor backed by the shared provider catalog. */
export default function ScheduleEditorWorkspace({
  project,
  editingSchedule,
  onClose,
  onOpenAgentSettings,
}: ScheduleEditorWorkspaceProps) {
  const scheduleActions = useScheduledRuns();
  const catalogState = useProviderSelectionCatalog();
  return (
    <ScheduleEditorWorkspaceView
      project={project}
      editingSchedule={editingSchedule}
      onClose={onClose}
      onOpenAgentSettings={onOpenAgentSettings}
      scheduleActions={scheduleActions}
      catalogState={catalogState}
    />
  );
}

/** Presentational schedule editor used by Storybook with deterministic service fixtures. */
export function ScheduleEditorWorkspaceView({
  project,
  editingSchedule,
  onClose,
  onOpenAgentSettings,
  scheduleActions,
  catalogState,
}: ScheduleEditorWorkspaceViewProps) {
  const { create, update, runNow } = scheduleActions;
  const parsedSchedule = useMemo(
    () => parseSimpleSchedule(editingSchedule?.cronExpression ?? '0 8 * * *'),
    [editingSchedule?.cronExpression],
  );
  const titleRef = useRef<HTMLInputElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const [title, setTitle] = useState(editingSchedule?.title ?? '');
  const [mode, setMode] = useState<ScheduleMode>(parsedSchedule.mode);
  const [time, setTime] = useState(parsedSchedule.time);
  const [weeklyDay, setWeeklyDay] = useState(parsedSchedule.weeklyDay);
  const [customDays, setCustomDays] = useState<number[]>(parsedSchedule.customDays);
  const [timezone, setTimezone] = useState(editingSchedule?.timezone ?? detectedTimezone());
  const [advancedOpen, setAdvancedOpen] = useState(parsedSchedule.advanced);
  const [rawCron, setRawCron] = useState(editingSchedule?.cronExpression ?? '0 8 * * *');
  const [provider, setProvider] = useState<ScheduleProvider>(editingSchedule?.provider ?? 'claude');
  const [providerProfileId, setProviderProfileId] = useState<number | null>(editingSchedule?.providerProfileId ?? null);
  const [model, setModel] = useState(editingSchedule?.model ?? '');
  const [prompt, setPrompt] = useState(editingSchedule?.prompt ?? '');
  const [notifyOnSuccess, setNotifyOnSuccess] = useState(editingSchedule?.notifyOnSuccess ?? false);
  const [notifyOnFailure, setNotifyOnFailure] = useState(editingSchedule?.notifyOnFailure ?? true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [runNowState, setRunNowState] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [runNowMessage, setRunNowMessage] = useState<string | null>(null);

  const generatedCron = useMemo(
    () => cronForSchedule(mode, time, weeklyDay, customDays),
    [customDays, mode, time, weeklyDay],
  );
  const cronExpression = advancedOpen ? rawCron.trim() : generatedCron;
  const cronValidation = useMemo(() => validateCron(cronExpression), [cronExpression]);
  const preview = useMemo(() => {
    if (!cronValidation.ok) return { runs: [] as Date[], error: cronValidation.error };
    try {
      return { runs: nextCronRuns(cronExpression, timezone, new Date(), 3), error: null };
    } catch (error) {
      return { runs: [] as Date[], error: error instanceof Error ? error.message : 'Unable to preview this schedule.' };
    }
  }, [cronExpression, cronValidation, timezone]);

  const providerEntry = catalogState.getEntry(provider);
  const providerAvailable = Boolean(providerEntry?.available);
  const profileRequired = isProfileProvider(provider);
  const profileValid = !profileRequired
    ? providerProfileId === null
    : Boolean(providerEntry?.profiles.some((profile) => profile.id === providerProfileId));
  const modelValid = Boolean(providerEntry?.models.OPTIONS.some((option) => option.value === model));
  const catalog = catalogState.catalog;
  const getCatalogEntry = catalogState.getEntry;
  const listAvailableProviders = catalogState.listAvailable;

  useEffect(() => {
    if (!catalog) return;
    const currentEntry = getCatalogEntry(provider);
    if (!currentEntry?.available && !editingSchedule) {
      const fallback = listAvailableProviders()[0];
      if (fallback) {
        setProvider(fallback.provider);
        setProviderProfileId(defaultProfileForEntry(fallback)?.id ?? null);
        setModel(resolveCatalogModel(fallback, null) ?? '');
      }
      return;
    }
    if (!currentEntry?.available) return;
    if (isProfileProvider(currentEntry.provider)) {
      if (!currentEntry.profiles.some((profile) => profile.id === providerProfileId)) {
        setProviderProfileId(defaultProfileForEntry(currentEntry)?.id ?? null);
      }
    } else if (providerProfileId !== null) {
      setProviderProfileId(null);
    }
    if (!currentEntry.models.OPTIONS.some((option) => option.value === model)) {
      setModel(resolveCatalogModel(currentEntry, editingSchedule?.model ?? null) ?? '');
    }
  }, [catalog, editingSchedule, getCatalogEntry, listAvailableProviders, model, provider, providerProfileId]);

  const handleProviderChange = (nextProvider: ScheduleProvider) => {
    const nextEntry = catalogState.getEntry(nextProvider);
    setProvider(nextProvider);
    setProviderProfileId(defaultProfileForEntry(nextEntry)?.id ?? null);
    setModel(resolveCatalogModel(nextEntry, null) ?? '');
  };

  const validateForm = (): string | null => {
    if (!title.trim()) {
      titleRef.current?.focus();
      return 'Title is required.';
    }
    if (!prompt.trim()) {
      promptRef.current?.focus();
      return 'Prompt is required.';
    }
    if (preview.error) return preview.error;
    if (!providerAvailable) return providerEntry?.unavailableReason ?? 'The selected provider is unavailable.';
    if (!profileValid) return 'Choose an available provider profile.';
    if (!modelValid) return 'Choose an available model.';
    return null;
  };

  const handleSave = async () => {
    const error = validateForm();
    if (error) {
      setSaveError(error);
      setSaveState('failed');
      return;
    }
    setSaveState('saving');
    setSaveError(null);
    const payload = {
      title: title.trim(),
      projectId: project.projectId,
      provider,
      providerProfileId,
      model,
      prompt: prompt.trim(),
      cronExpression,
      timezone,
      notifyOnSuccess,
      notifyOnFailure,
      isEnabled: editingSchedule?.isEnabled ?? true,
    };
    try {
      if (editingSchedule) await update(editingSchedule.id, payload);
      else await create(payload);
      onClose();
    } catch (error) {
      setSaveState('failed');
      setSaveError(error instanceof Error ? error.message : 'Failed to save schedule.');
    }
  };

  const handleRunNow = async () => {
    if (!editingSchedule) return;
    setRunNowState('running');
    setRunNowMessage('Starting the scheduled run…');
    try {
      await runNow(editingSchedule.id);
      setRunNowState('success');
      setRunNowMessage('Run started. Progress will appear in schedule history.');
    } catch (error) {
      setRunNowState('failed');
      setRunNowMessage(error instanceof Error ? error.message : 'Failed to start this run.');
    }
  };

  const formatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }), [timezone]);

  return (
    <section className="h-full overflow-y-auto bg-background p-4 sm:p-6" aria-labelledby="schedule-workspace-title">
      <form
        className="mx-auto max-w-4xl space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (saveState !== 'saving') void handleSave();
        }}
      >
        <header>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Schedules</p>
          <h2 id="schedule-workspace-title" className="mt-1 text-2xl font-semibold text-foreground">
            {editingSchedule ? `Edit ${editingSchedule.title}` : `Schedule work for ${project.displayName}`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Create a recurring local agent run without leaving the project workspace.</p>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
          <div className="space-y-5 rounded-2xl border border-border bg-card p-5">
            <Field label="Title" htmlFor="schedule-title">
              <input ref={titleRef} id="schedule-title" value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} placeholder="Daily project summary" />
            </Field>

            <div>
              <span className="block text-sm font-medium text-foreground">Project</span>
              <div className="mt-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground">
                {project.displayName} <span className="text-muted-foreground">· current workspace</span>
              </div>
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-foreground">Frequency</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {([
                  ['daily', 'Daily'],
                  ['weekly', 'Weekly'],
                  ['custom', 'Custom time'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    onClick={() => setMode(value)}
                    className={cn(
                      'min-h-11 rounded-lg border px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      mode === value ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Time" htmlFor="schedule-time">
                <input id="schedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className={inputClass} />
              </Field>
              {mode === 'weekly' && (
                <Field label="Day" htmlFor="schedule-weekday">
                  <select id="schedule-weekday" value={weeklyDay} onChange={(event) => setWeeklyDay(Number(event.target.value))} className={inputClass}>
                    {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                  </select>
                </Field>
              )}
            </div>

            {mode === 'custom' && (
              <fieldset>
                <legend className="text-sm font-medium text-foreground">Run on</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WEEKDAYS.map((day) => {
                    const selected = customDays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setCustomDays((current) => selected
                          ? current.filter((value) => value !== day.value)
                          : [...current, day.value])}
                        className={cn(
                          'min-h-11 min-w-11 rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {day.short}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            <Field label="Prompt" htmlFor="schedule-prompt">
              <textarea ref={promptRef} id="schedule-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} className={inputClass} placeholder="Describe the work the agent should perform…" />
            </Field>

            <button
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => {
                if (!advancedOpen) setRawCron(generatedCron);
                setAdvancedOpen((open) => !open);
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform', advancedOpen && 'rotate-180')} aria-hidden="true" />
              Advanced
            </button>

            {advancedOpen && (
              <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                <Field label="Cron expression" htmlFor="schedule-cron" hint="Advanced only · five-field cron">
                  <input id="schedule-cron" value={rawCron} onChange={(event) => setRawCron(event.target.value)} className={cn(inputClass, 'font-mono')} />
                </Field>
                <Field label="Timezone" htmlFor="schedule-timezone" hint="Detected automatically; change only when this schedule follows another location.">
                  <input id="schedule-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} className={inputClass} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle label="Notify on success" checked={notifyOnSuccess} onChange={setNotifyOnSuccess} />
                  <Toggle label="Notify on failure" checked={notifyOnFailure} onChange={setNotifyOnFailure} />
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <Clock3 className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="font-semibold text-foreground">Next three runs</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Timezone: {timezone}</p>
              {preview.error ? (
                <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{preview.error}</p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {preview.runs.map((run, index) => (
                    <li key={run.toISOString()} className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background font-medium text-foreground">{index + 1}</span>
                      <time dateTime={run.toISOString()} className="text-foreground">{formatter.format(run)}</time>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="font-semibold text-foreground">Agent</h3>
              </div>
              {catalogState.loading ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading providers…</div>
              ) : catalogState.error ? (
                <div className="mt-4" role="alert">
                  <p className="text-sm text-destructive">{catalogState.error}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={catalogState.reload} className="min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Retry</button>
                    <button type="button" onClick={onOpenAgentSettings} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent">Open Settings</button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <Field label="Provider" htmlFor="schedule-provider">
                    <select id="schedule-provider" value={provider} onChange={(event) => handleProviderChange(event.target.value as ScheduleProvider)} className={inputClass}>
                      {catalogState.catalog?.providers.map((entry) => (
                        <option key={entry.provider} value={entry.provider} disabled={!entry.available}>
                          {entry.provider} {entry.available ? '' : '— unavailable'}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {profileRequired && (
                    <Field label="Profile" htmlFor="schedule-profile">
                      <select id="schedule-profile" value={providerProfileId ?? ''} onChange={(event) => setProviderProfileId(Number(event.target.value))} className={inputClass}>
                        <option value="" disabled>Choose a profile</option>
                        {providerEntry?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label="Model" htmlFor="schedule-model">
                    <select id="schedule-model" value={model} onChange={(event) => setModel(event.target.value)} className={inputClass}>
                      <option value="" disabled>Choose a model</option>
                      {providerEntry?.models.OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </Field>
                  {!providerAvailable && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3" role="alert">
                      <p className="text-sm text-destructive">{providerEntry?.unavailableReason ?? 'This provider is unavailable.'}</p>
                      <button type="button" onClick={onOpenAgentSettings} className="mt-3 min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent">Open Settings</button>
                    </div>
                  )}
                </div>
              )}
            </section>
          </aside>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/50 p-4 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="font-medium">Desktop or the local server must be running at execution time.</p>
            <p className="mt-1 text-muted-foreground">Runs missed while it is stopped are marked Missed and are not replayed automatically.</p>
          </div>
        </div>

        {saveError && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{saveError}</p>}
        {runNowMessage && (
          <div className={cn('rounded-lg border p-3 text-sm', runNowState === 'failed' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-border bg-muted/30 text-foreground')} role="status">
            <p>{runNowMessage}</p>
            {runNowState === 'failed' && (
              <button type="button" onClick={onOpenAgentSettings} className="mt-3 min-h-11 rounded-lg border border-border bg-background px-3 py-2 font-medium text-foreground hover:bg-accent">
                Open Settings
              </button>
            )}
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {editingSchedule && (
            <button type="button" onClick={() => void handleRunNow()} disabled={runNowState === 'running'} className="mr-auto min-h-11 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60">
              {runNowState === 'running' ? 'Starting…' : 'Run now'}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saveState === 'saving'} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={saveState === 'saving' || catalogState.loading || Boolean(catalogState.error)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
            {saveState === 'saving' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {saveState === 'saving' ? 'Saving…' : 'Save schedule'}
          </button>
        </footer>
      </form>
    </section>
  );
}

const inputClass = 'min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5" />
      {label}
    </label>
  );
}
