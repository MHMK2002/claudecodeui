import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export type RewindTarget = {
  messageId: string;
  preview: string;
  pending: boolean;
  error?: string;
};

type RewindConfirmModalProps = {
  target: RewindTarget | null;
  onConfirm: () => void;
  onCancel: () => void;
};

const RewindConfirmModal = ({ target, onConfirm, onCancel }: RewindConfirmModalProps) => {
  const { t } = useTranslation('chat');

  useEffect(() => {
    if (!target) return undefined;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !target.pending) {
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
      onClick={() => !target.pending && onCancel()}
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
              'The user message above and everything after it will be permanently deleted from this conversation. A backup copy of the original transcript will be saved next to the transcript file.',
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
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={target.pending}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('rewind.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={target.pending}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {target.pending
              ? t('rewind.rewinding', { defaultValue: 'Rewinding…' })
              : t('rewind.confirm', { defaultValue: 'Rewind' })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RewindConfirmModal;
