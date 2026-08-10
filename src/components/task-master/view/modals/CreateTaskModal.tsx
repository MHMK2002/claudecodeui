import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, MessageSquareText, Mic, RefreshCw, Sparkles, Square, X } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import { useVoiceInput } from '../../../chat/hooks/useVoiceInput';
import type { TaskMasterProject } from '../../types';
import { getTextDirection } from '../../../../utils/textDirection';
import {
  approveTaskIntake,
  listTaskIntakes,
  startTaskIntake,
  type TaskIntakeRecord,
  type TaskWorkflowCallbacks,
} from '../../workflow';

type CreateTaskModalProps = TaskWorkflowCallbacks & {
  isOpen: boolean;
  onClose: () => void;
  project: TaskMasterProject | null;
  onTaskCreated?: (() => void) | null;
};

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
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceInterim, setVoiceInterim] = useState<string | null>(null);

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

  if (!isOpen) return null;

  const displayedBrief = voiceInterim?.trim()
    ? `${brief.trimEnd()}${brief.trim() ? ' ' : ''}${voiceInterim.trim()}`
    : brief;

  const handleStartIntake = async () => {
    if (!project || !brief.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      await startTaskIntake({
        project,
        brief: brief.trim(),
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

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 p-5 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Capture a new task</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Speak or type your idea. The agent will clarify what matters.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          <div className="space-y-2">
            <label htmlFor="task-intake-brief" className="text-sm font-medium text-gray-800 dark:text-gray-200">What do you want to build?</label>
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
                rows={4}
                placeholder="Describe the outcome."
                className="min-w-0 flex-1 resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
              <button
                type="button"
                onClick={() => void toggleVoice()}
                disabled={voiceState === 'transcribing'}
                aria-label={voiceState === 'recording' ? 'Stop task voice recording' : 'Record task with voice'}
                className={cn(
                  'inline-flex w-11 shrink-0 items-center justify-center rounded-lg border text-sm transition-colors',
                  voiceState === 'recording'
                    ? 'border-red-500 bg-red-500 text-white hover:bg-red-600'
                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 dark:hover:text-blue-400',
                  voiceState === 'transcribing' && 'cursor-wait opacity-60',
                )}
              >
                {voiceState === 'recording' ? (
                  <Square className="h-3.5 w-3.5 fill-current" />
                ) : voiceState === 'transcribing' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {voiceState === 'recording'
                  ? 'Recording… tap the red button when finished.'
                  : voiceState === 'transcribing'
                    ? 'Turning your recording into text…'
                    : 'You can edit the transcript before clarification starts.'}
              </p>
              <button
                type="button"
                onClick={() => void handleStartIntake()}
                disabled={!project || !brief.trim() || isLoading || voiceState !== 'idle'}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
                {isLoading ? 'Opening Q&A…' : 'Start Q&A'}
              </button>
            </div>
          </div>

          <TaskIntakeQuestionPreview isLoading={isLoading} />

          {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Intake proposals</h4>
              <button type="button" onClick={() => void refreshIntakes()} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" title="Refresh proposals">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            {intakes.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500 dark:border-gray-700">No intake sessions yet.</p>
            ) : (
              <div className="space-y-3">
                {intakes.map((intake) => (
                  <div key={intake.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{intake.proposal?.title || intake.brief}</p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {intake.taskId
                            ? `Approved as Task ${intake.taskId}`
                            : intake.proposalReady
                              ? 'Ready for explicit approval'
                              : intake.proposalError || 'Continue clarification in its session'}
                        </p>
                      </div>
                      <span className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">{intake.status}</span>
                    </div>

                    {intake.proposal && (
                      <div className="mt-3 space-y-2 rounded-md bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-800/70 dark:text-gray-300">
                        <p className="whitespace-pre-wrap">{intake.proposal.description}</p>
                        <p><span className="font-medium">Acceptance:</span> {intake.proposal.acceptanceCriteria.join(' · ') || 'None recorded'}</p>
                        <p><span className="font-medium">Unresolved:</span> {intake.proposal.unresolvedQuestions.join(' · ') || 'None'}</p>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {intake.sessionId && !intake.taskId && (
                        <button
                          type="button"
                          onClick={() => {
                            onNavigateToSession?.(intake.sessionId!);
                            onClose();
                          }}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                        >
                          Continue / Edit in session
                        </button>
                      )}
                      {!intake.taskId && (
                        <button
                          type="button"
                          onClick={() => void handleApprove(intake)}
                          disabled={!intake.proposalReady || activeAction === intake.id}
                          className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {activeAction === intake.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Approve and create pending task
                        </button>
                      )}
                      {!intake.taskId && (
                        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                          Reject / Close
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TaskIntakeQuestionPreview({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400" />
            ) : (
              <MessageSquareText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            )}
          </div>
          <p className="text-xs font-semibold text-gray-900 dark:text-white">
            {isLoading ? 'Opening Q&A session' : 'Q&A session preview'}
          </p>
        </div>
        <span className="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-400">
          1/3
        </span>
      </div>

      <div aria-hidden="true" className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            CloudCLI needs input
          </span>
          <span className="rounded border border-blue-100 bg-blue-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-blue-600 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-400">
            Scope
          </span>
        </div>
        <p className="text-[13px] font-medium leading-snug text-gray-900 dark:text-gray-100">
          What should count as done for this task?
        </p>
        <div className="mt-2 space-y-1.5">
          {[
            'Working UI and saved changes',
            'Tests/build pass',
            'Other...',
          ].map((option, index) => (
            <div
              key={option}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-start dark:border-gray-700 dark:bg-gray-900/40"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-100 font-mono text-[10px] text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
                {index === 2 ? 0 : index + 1}
              </span>
              <span className="text-[12px] text-gray-700 dark:text-gray-300">{option}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
