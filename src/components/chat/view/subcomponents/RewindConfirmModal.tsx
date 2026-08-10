import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  RewindTarget,
  SessionRewindMode,
} from '../../hooks/useChatSessionState';

type RewindConfirmModalProps = {
  target: RewindTarget | null;
  onConfirm: (mode: SessionRewindMode) => void | Promise<void>;
  onCancel: () => void;
};

const RewindConfirmModal = ({ target, onConfirm, onCancel }: RewindConfirmModalProps) => {
  const { t } = useTranslation('chat');

  useEffect(() => {
    if (!target) return undefined;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !target.pendingMode) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [target, onCancel]);

  if (!target) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={() => !target.pendingMode && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rewind-modal-title"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="rewind-modal-title" className="mb-2 text-base font-semibold text-foreground">
          {t('rewind.modalTitle', { defaultValue: 'Rewind to this message?' })}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {t('rewind.modalDescription', {
            defaultValue:
              'Choose what to restore. Restoring the conversation keeps this chat in place and puts the selected prompt back in the input.',
          })}
        </p>
        {target.preview && (
          <blockquote className="mb-3 max-h-32 overflow-y-auto rounded border border-border bg-muted/40 px-3 py-2 text-xs italic text-muted-foreground">
            {target.preview}
          </blockquote>
        )}
        {target.error && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {target.error}
          </div>
        )}
        {target.canRestoreFiles && target.filesChanged.length > 0 && (
          <div className="mb-3 rounded border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {t('rewind.filesChanged', {
              count: target.filesChanged.length,
              defaultValue: '{{count}} changed file(s) can be restored.',
            })}
          </div>
        )}
        {target.fileRestoreError && !target.canRestoreFiles && (
          <div className="mb-3 text-xs text-muted-foreground">{target.fileRestoreError}</div>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={Boolean(target.pendingMode)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('rewind.cancel', { defaultValue: 'Cancel' })}
          </button>
          {target.loading ? (
            <span className="px-3 py-1.5 text-sm text-muted-foreground">
              {t('rewind.inspecting', { defaultValue: 'Checking restore options…' })}
            </span>
          ) : (
            <>
              {target.canRestoreFiles && (
                <button
                  type="button"
                  onClick={() => onConfirm('code')}
                  disabled={Boolean(target.pendingMode)}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {target.pendingMode === 'code'
                    ? t('rewind.rewinding', { defaultValue: 'Restoring…' })
                    : t('rewind.restoreCode', { defaultValue: 'Restore code' })}
                </button>
              )}
              {target.canRestoreConversation && (
                <button
                  type="button"
                  onClick={() => onConfirm('conversation')}
                  disabled={Boolean(target.pendingMode)}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {target.pendingMode === 'conversation'
                    ? t('rewind.rewinding', { defaultValue: 'Restoring…' })
                    : t('rewind.restoreConversation', { defaultValue: 'Restore conversation' })}
                </button>
              )}
              {target.canRestoreConversation && target.canRestoreFiles && (
                <button
                  type="button"
                  onClick={() => onConfirm('both')}
                  disabled={Boolean(target.pendingMode)}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {target.pendingMode === 'both'
                    ? t('rewind.rewinding', { defaultValue: 'Restoring…' })
                    : t('rewind.restoreBoth', { defaultValue: 'Restore code and conversation' })}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RewindConfirmModal;
