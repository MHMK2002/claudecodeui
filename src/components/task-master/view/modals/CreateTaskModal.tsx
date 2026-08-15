import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, MessageSquareText, Mic, RefreshCw, Sparkles, Square, X } from 'lucide-react';

import {
  isProfileProvider,
  resolveValidSelection,
  useProviderSelectionCatalog,
  validateCatalogSelection,
} from '../../../../shared/hooks/useProviderSelectionCatalog';
import { Button, Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';
import type {
  LLMProvider,
  ProviderSelectionCatalog,
  ResolvedProviderSelection,
} from '../../../../types/app';
import { getTextDirection } from '../../../../utils/textDirection';
import { useVoiceInput } from '../../../chat/hooks/useVoiceInput';
import type { TaskMasterProject } from '../../types';
import {
  approveTaskIntake,
  listTaskIntakes,
  readStoredTaskQaSelection,
  startTaskIntake,
  writeStoredTaskQaSelection,
  type TaskIntakeRecord,
  type TaskWorkflowCallbacks,
} from '../../workflow';

type CreateTaskModalProps = TaskWorkflowCallbacks & {
  isOpen: boolean;
  onClose: () => void;
  project: TaskMasterProject | null;
  onTaskCreated?: (() => void) | null;
};

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

function resolveInitialSelection(
  catalog: ProviderSelectionCatalog,
): ResolvedProviderSelection | null {
  const stored = readStoredTaskQaSelection();
  if (stored) {
    const preferred = resolveValidSelection(catalog, stored.provider, {
      profileId: stored.providerProfileId,
      model: stored.model,
    });
    if (preferred) {
      return preferred;
    }
  }

  for (const entry of catalog.providers) {
    const fallback = resolveValidSelection(catalog, entry.provider);
    if (fallback) {
      return fallback;
    }
  }
  return null;
}

export default function CreateTaskModal({
  isOpen,
  onClose,
  project,
  onTaskCreated = null,
  sendMessage,
  onSessionEstablished,
  onNavigateToSession,
  onSessionProcessing,
}: CreateTaskModalProps) {
  const [brief, setBrief] = useState('');
  const [intakes, setIntakes] = useState<TaskIntakeRecord[]>([]);
  const [selection, setSelection] = useState<ResolvedProviderSelection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceInterim, setVoiceInterim] = useState<string | null>(null);
  const {
    catalog,
    loading: catalogLoading,
    error: catalogError,
    reload: reloadCatalog,
  } = useProviderSelectionCatalog();

  const handleVoiceTranscript = useCallback((text: string) => {
    const transcript = text.trim();
    if (!transcript) return;
    setVoiceInterim(null);
    setBrief((previous) => previous.trim()
      ? `${previous.trim()} ${transcript}`
      : transcript);
  }, []);
  const {
    state: voiceState,
    toggle: toggleVoice,
    detach: detachVoice,
  } = useVoiceInput(handleVoiceTranscript, setError, setVoiceInterim);

  const refreshIntakes = useCallback(async () => {
    if (!project) return;
    try {
      const records = await listTaskIntakes(project);
      setIntakes(records);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to load task intakes.');
    }
  }, [project]);

  useEffect(() => {
    if (!isOpen || !project) return;
    void refreshIntakes();
    const timer = window.setInterval(() => void refreshIntakes(), 2000);
    return () => window.clearInterval(timer);
  }, [isOpen, project, refreshIntakes]);

  useEffect(() => {
    if (isOpen) return;
    detachVoice();
    setVoiceInterim(null);
  }, [detachVoice, isOpen]);

  useEffect(() => {
    if (!isOpen || !catalog) return;
    setSelection((current) => {
      if (current && validateCatalogSelection(catalog, current) === null) {
        return current;
      }
      return resolveInitialSelection(catalog);
    });
  }, [catalog, isOpen]);

  const providerEntry = useMemo(
    () => catalog?.providers.find((entry) => entry.provider === selection?.provider) ?? null,
    [catalog, selection?.provider],
  );
  const selectionError = useMemo(() => {
    if (catalogLoading) return null;
    if (catalogError) return catalogError;
    if (!catalog || !selection) return 'Configure and connect a provider in Settings before starting Q&A.';
    return validateCatalogSelection(catalog, selection);
  }, [catalog, catalogError, catalogLoading, selection]);

  const displayedBrief = voiceInterim?.trim()
    ? `${brief.trimEnd()}${brief.trim() ? ' ' : ''}${voiceInterim.trim()}`
    : brief;

  const handleProviderChange = (provider: LLMProvider) => {
    if (!catalog) return;
    setSelection(resolveValidSelection(catalog, provider));
  };

  const handleProfileChange = (profileId: number) => {
    if (!catalog || !selection) return;
    setSelection(resolveValidSelection(catalog, selection.provider, {
      profileId,
      model: selection.model,
    }));
  };

  const handleStartIntake = async () => {
    if (!project || !brief.trim()) return;
    if (!selection || selectionError) {
      setError(selectionError || 'Choose a valid provider, profile, and model.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      writeStoredTaskQaSelection(selection);
      await startTaskIntake({
        project,
        brief: brief.trim(),
        selection,
        sendMessage,
        onSessionEstablished,
        onNavigateToSession,
        onSessionProcessing,
      });
      setBrief('');
      onClose();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Failed to start task intake.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (intake: TaskIntakeRecord) => {
    if (!project) return;
    setActiveAction(intake.id);
    setError(null);
    try {
      await approveTaskIntake({ project, intake });
      await refreshIntakes();
      onTaskCreated?.();
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Failed to approve the task.');
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[min(92dvh,52rem)] w-[calc(100vw-1rem)] max-w-2xl flex-col overflow-hidden rounded-2xl border-border/80 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl sm:w-[min(94vw,42rem)]">
        <DialogTitle>Capture a new task</DialogTitle>

        <header className="flex items-start gap-3 border-b border-border/60 bg-muted/20 px-4 py-3.5 sm:px-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 text-start">
            <h3 className="text-sm font-semibold text-foreground sm:text-base">Capture a new task</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Describe the outcome, then choose who should run the clarification session.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close task dialog" className="-me-1 -mt-1 h-8 w-8 text-muted-foreground">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <section className="space-y-3 rounded-xl border border-border/70 bg-background/70 p-3.5">
            <div className="space-y-1.5">
              <label htmlFor="task-intake-brief" className="text-xs font-semibold text-foreground">What do you want to build?</label>
              <div className="flex items-stretch gap-2">
                <textarea
                  id="task-intake-brief"
                  value={displayedBrief}
                  dir={getTextDirection(displayedBrief)}
                  onChange={(event) => {
                    setVoiceInterim(null);
                    setBrief(event.target.value);
                  }}
                  readOnly={voiceState !== 'idle'}
                  rows={3}
                  placeholder="Describe the outcome and the constraints that matter."
                  className="min-h-24 min-w-0 flex-1 resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <Button
                  type="button"
                  variant={voiceState === 'recording' ? 'destructive' : 'outline'}
                  size="icon"
                  onClick={() => void toggleVoice()}
                  disabled={voiceState === 'transcribing'}
                  aria-label={voiceState === 'recording' ? 'Stop task voice recording' : 'Record task with voice'}
                  aria-pressed={voiceState === 'recording'}
                  className="h-auto min-h-10 w-10 shrink-0"
                >
                  {voiceState === 'recording' ? (
                    <Square className="h-3.5 w-3.5 fill-current" />
                  ) : voiceState === 'transcribing' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {voiceState === 'recording'
                  ? 'Recording… tap the red button when finished.'
                  : voiceState === 'transcribing'
                    ? 'Turning your recording into text…'
                    : 'You can edit the transcript before clarification starts.'}
              </p>
            </div>

            <div className="border-t border-border/60 pt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">Q&A runtime</p>
                  <p className="text-[11px] text-muted-foreground">Providers and models are loaded from Settings.</p>
                </div>
                {catalogError ? (
                  <Button type="button" variant="ghost" size="sm" onClick={reloadCatalog} className="h-7 px-2 text-xs">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                ) : null}
              </div>

              <div className="grid gap-2.5 sm:grid-cols-3">
                <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
                  <span>Provider</span>
                  <select
                    value={selection?.provider ?? ''}
                    onChange={(event) => handleProviderChange(event.target.value as LLMProvider)}
                    disabled={catalogLoading || !catalog}
                    className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="" disabled>{catalogLoading ? 'Loading…' : 'Select provider'}</option>
                    {(catalog?.providers ?? []).map((entry) => (
                      <option key={entry.provider} value={entry.provider} disabled={!entry.available}>
                        {PROVIDER_LABELS[entry.provider]}{entry.available ? '' : ` — ${entry.unavailableReason || 'Unavailable'}`}
                      </option>
                    ))}
                  </select>
                </label>

                {selection && isProfileProvider(selection.provider) ? (
                  <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
                    <span>Profile</span>
                    <select
                      value={selection.providerProfileId ?? ''}
                      onChange={(event) => handleProfileChange(Number(event.target.value))}
                      className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    >
                      {(providerEntry?.profiles ?? []).map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.title}{profile.isDefault ? ' (Default)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="space-y-1 text-[11px] font-medium text-muted-foreground">
                    <span>Connection</span>
                    <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-2.5 text-xs text-foreground">
                      Managed connection
                    </div>
                  </div>
                )}

                <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
                  <span>Model</span>
                  <select
                    value={selection?.model ?? ''}
                    onChange={(event) => {
                      if (!selection) return;
                      setSelection({ ...selection, model: event.target.value });
                    }}
                    disabled={!selection || !providerEntry}
                    className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="" disabled>Select model</option>
                    {(providerEntry?.models.OPTIONS ?? []).map((model) => (
                      <option key={model.value} value={model.value}>{model.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              {selectionError ? (
                <p className="mt-2 text-[11px] leading-relaxed text-destructive" role="status">{selectionError}</p>
              ) : null}
            </div>

            <div className="flex flex-col-reverse items-stretch gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                className="h-9 px-4 text-xs text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleStartIntake()}
                disabled={!project || !brief.trim() || !selection || Boolean(selectionError) || catalogLoading || isLoading || voiceState !== 'idle'}
                className="h-9 px-4 text-xs"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
                {isLoading ? 'Opening Q&A…' : 'Start Q&A'}
              </Button>
            </div>
          </section>

          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</div>
          ) : null}

          <section className="border-t border-border/60 pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Intake proposals</h4>
                <p className="text-[11px] text-muted-foreground">Review, continue, or approve earlier clarification sessions.</p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => void refreshIntakes()} className="h-8 w-8 text-muted-foreground" title="Refresh proposals" aria-label="Refresh proposals">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            {intakes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No intake sessions yet.</p>
            ) : (
              <div className="space-y-2.5">
                {intakes.map((intake) => (
                  <article key={intake.id} className="rounded-xl border border-border/70 bg-background/60 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 text-start" dir={getTextDirection(intake.proposal?.title || intake.brief)}>
                        <p className="truncate text-sm font-medium text-foreground">{intake.proposal?.title || intake.brief}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {intake.taskId
                            ? `Approved as Task ${intake.taskId}`
                            : intake.proposalReady
                              ? 'Ready for explicit approval'
                              : intake.proposalError || 'Continue clarification in its session'}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">{intake.status}</span>
                    </div>

                    {intake.proposal ? (
                      <div className="mt-3 space-y-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                        <p className="whitespace-pre-wrap text-foreground/90" dir={getTextDirection(intake.proposal.description)}>{intake.proposal.description}</p>
                        <p><span className="font-medium text-foreground">Acceptance:</span> {intake.proposal.acceptanceCriteria.join(' · ') || 'None recorded'}</p>
                        <p><span className="font-medium text-foreground">Unresolved:</span> {intake.proposal.unresolvedQuestions.join(' · ') || 'None'}</p>
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {intake.sessionId && !intake.taskId ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            onNavigateToSession?.(intake.sessionId!);
                            onClose();
                          }}
                          className="h-8 text-xs"
                        >
                          Continue / Edit in session
                        </Button>
                      ) : null}
                      {!intake.taskId ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleApprove(intake)}
                          disabled={!intake.proposalReady || activeAction === intake.id}
                          className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-600/90"
                        >
                          {activeAction === intake.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Approve and create pending task
                        </Button>
                      ) : null}
                      {!intake.taskId ? (
                        <Button type="button" variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs text-muted-foreground">
                          Reject / Close
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
