/**
 * ScheduleEditorModal — centered modal form for creating / editing a schedule.
 *
 * Mirrors the plain `div` overlay pattern used by `CreateTaskModal.tsx`
 * (no Portal, no shadcn). Form state is local; submit goes through
 * `useScheduledRuns.create` / `.update`. Cmd/Ctrl+Enter inside the prompt
 * textarea submits (a new pattern not currently used elsewhere in the app).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { describeCron, validateCron } from '../../../utils/cron';
import { useScheduledRuns } from '../../../contexts/ScheduledRunsContext';
import type { ScheduleProvider, ScheduledRun } from '../../../types/scheduledRuns';

type ScheduleEditorModalProps = {
  open: boolean;
  editingSchedule: ScheduledRun | null;
  onClose: () => void;
};

const PROVIDER_OPTIONS: { id: ScheduleProvider; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'opencode', label: 'OpenCode' },
];

const DEFAULT_MODEL: Record<ScheduleProvider, string> = {
  claude: 'claude-sonnet-4',
  codex: 'gpt-5.4',
  cursor: 'gpt-5',
  opencode: 'default',
};

const PROMPT_TEMPLATES: { id: string; label: string; prompt: string }[] = [
  {
    id: 'custom',
    label: 'Custom',
    prompt: '',
  },
  {
    id: 'dailyDigest',
    label: 'Daily digest',
    prompt:
      'Summarize the changes that landed in this project over the last 24 hours. List the top 5 most important commits with one-sentence summaries each.',
  },
  {
    id: 'weeklyCodeReview',
    label: 'Weekly code review',
    prompt:
      'Review the open pull requests and unmerged branches in this project. Identify any that are stale (>7 days), blocked, or have failing checks. Propose next actions for each.',
  },
  {
    id: 'nightlyTestRun',
    label: 'Nightly test run',
    prompt:
      'Run the test suite for this project. Report which tests pass, fail, and whether the failure rate has increased compared to the previous run.',
  },
];

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function ScheduleEditorModal({ open, editingSchedule, onClose }: ScheduleEditorModalProps) {
  const { create, update } = useScheduledRuns();

  const [title, setTitle] = useState('');
  const [cronExpression, setCronExpression] = useState('0 8 * * *');
  const [timezone, setTimezone] = useState(defaultTimezone());
  const [projectPath, setProjectPath] = useState('');
  const [provider, setProvider] = useState<ScheduleProvider>('claude');
  const [model, setModel] = useState<string>(DEFAULT_MODEL.claude);
  const [prompt, setPrompt] = useState('');
  const [notifyOnSuccess, setNotifyOnSuccess] = useState(false);
  const [notifyOnFailure, setNotifyOnFailure] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Reset form when the modal opens or the editing target changes.
  useEffect(() => {
    if (!open) return;
    if (editingSchedule) {
      setTitle(editingSchedule.title);
      setCronExpression(editingSchedule.cronExpression);
      setTimezone(editingSchedule.timezone);
      setProjectPath(editingSchedule.projectPath);
      setProvider(editingSchedule.provider);
      setModel(editingSchedule.model);
      setPrompt(editingSchedule.prompt);
      setNotifyOnSuccess(editingSchedule.notifyOnSuccess);
      setNotifyOnFailure(editingSchedule.notifyOnFailure);
    } else {
      setTitle('');
      setCronExpression('0 8 * * *');
      setTimezone(defaultTimezone());
      setProjectPath('');
      setProvider('claude');
      setModel(DEFAULT_MODEL.claude);
      setPrompt('');
      setNotifyOnSuccess(false);
      setNotifyOnFailure(true);
    }
    setErrors([]);
  }, [open, editingSchedule]);

  const cronValidation = useMemo(() => validateCron(cronExpression), [cronExpression]);
  const cronDescription = useMemo(() => {
    if (!cronValidation.ok) return cronValidation.error;
    return describeCron(cronExpression, timezone);
  }, [cronExpression, timezone, cronValidation]);

  const handleProviderChange = useCallback((next: ScheduleProvider) => {
    setProvider(next);
    setModel(DEFAULT_MODEL[next]);
  }, []);

  const handleTemplateClick = useCallback((templateId: string) => {
    const template = PROMPT_TEMPLATES.find((entry) => entry.id === templateId);
    if (template && template.id !== 'custom') {
      setPrompt(template.prompt);
    }
  }, []);

  const validate = useCallback((): string[] => {
    const issues: string[] = [];
    if (!title.trim()) issues.push('Title is required');
    if (!projectPath.trim()) issues.push('Project path is required');
    if (!model.trim()) issues.push('Model is required');
    if (!prompt.trim()) issues.push('Prompt is required');
    if (!cronValidation.ok) issues.push(cronValidation.error ?? 'Invalid cron expression');
    return issues;
  }, [title, projectPath, model, prompt, cronValidation]);

  const handleSave = useCallback(async () => {
    const issues = validate();
    if (issues.length > 0) {
      setErrors(issues);
      return;
    }
    setErrors([]);
    setIsSaving(true);
    try {
      const payload = {
        title: title.trim(),
        projectPath: projectPath.trim(),
        provider,
        model: model.trim(),
        prompt,
        cronExpression: cronExpression.trim(),
        timezone,
        notifyOnSuccess,
        notifyOnFailure,
        isEnabled: true,
      };
      if (editingSchedule) {
        await update(editingSchedule.id, payload);
      } else {
        await create(payload);
      }
      onClose();
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : String(cause)]);
    } finally {
      setIsSaving(false);
    }
  }, [validate, title, projectPath, provider, model, prompt, cronExpression, timezone, notifyOnSuccess, notifyOnFailure, editingSchedule, create, update, onClose]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        if (!isSaving) void handleSave();
      }
    },
    [handleSave, isSaving],
  );

  const handleBackdropKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && !isSaving) onClose();
    },
    [isSaving, onClose],
  );

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onKeyDown={handleBackdropKey}
      onClick={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <div
        className={cn(
          'w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-2xl',
          'max-h-[90vh]',
        )}
      >
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">
            {editingSchedule ? 'Edit scheduled run' : 'New scheduled run'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={isSaving}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-5 px-6 py-5">
          <Field label="Title" error={errors.find((e) => e.toLowerCase().includes('title'))}>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={isSaving}
              placeholder="Morning Sentry Triage"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Cron expression"
              error={!cronValidation.ok ? cronValidation.error : undefined}
              hint="5 fields: minute hour day-of-month month day-of-week"
            >
              <input
                type="text"
                value={cronExpression}
                onChange={(event) => setCronExpression(event.target.value)}
                disabled={isSaving}
                placeholder="0 8 * * *"
                className={cn(inputClass, 'font-mono')}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{cronDescription}</p>
            </Field>

            <Field label="Timezone">
              <input
                type="text"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                disabled={isSaving}
                placeholder="UTC"
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Project path" error={errors.find((e) => e.toLowerCase().includes('project'))}>
            <input
              type="text"
              value={projectPath}
              onChange={(event) => setProjectPath(event.target.value)}
              disabled={isSaving}
              placeholder="/Users/you/projects/acme-api"
              className={cn(inputClass, 'font-mono')}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Provider">
              <div className="flex gap-1 rounded-md border border-border bg-background/40 p-1">
                {PROVIDER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleProviderChange(option.id)}
                    disabled={isSaving}
                    className={cn(
                      'flex-1 rounded px-2 py-1 text-xs transition-colors',
                      provider === option.id
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Model" error={errors.find((e) => e.toLowerCase().includes('model'))}>
              <input
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={isSaving}
                className={inputClass}
              />
            </Field>
          </div>

          <Field
            label="Prompt"
            error={errors.find((e) => e.toLowerCase().includes('prompt'))}
            hint="Cmd+Enter (or Ctrl+Enter) to save."
          >
            <div className="mb-2 flex flex-wrap gap-1">
              {PROMPT_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleTemplateClick(template.id)}
                  disabled={isSaving}
                  className="rounded-full border border-border bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {template.label}
                </button>
              ))}
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSaving}
              rows={6}
              placeholder="Check Sentry for unresolved errors in the last 24 hours…"
              className={cn(inputClass, 'font-mono text-xs')}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Toggle
              label="Notify on success"
              checked={notifyOnSuccess}
              onChange={setNotifyOnSuccess}
              disabled={isSaving}
            />
            <Toggle
              label="Notify on failure"
              checked={notifyOnFailure}
              onChange={setNotifyOnFailure}
              disabled={isSaving}
            />
          </div>

          {errors.length > 0 && (
            <ul className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-500">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border/60 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent/40 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : editingSchedule ? 'Save changes' : 'Create schedule'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

const inputClass =
  'w-full rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/40 focus:outline-none disabled:opacity-50';

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
};

function Field({ label, hint, error, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && !error ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
      {error ? <span className="mt-1 block text-[11px] text-red-500">{error}</span> : null}
    </label>
  );
}

type ToggleProps = {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
};

function Toggle({ label, checked, onChange, disabled }: ToggleProps) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="h-3.5 w-3.5"
      />
      <span className="text-foreground">{label}</span>
    </label>
  );
}
