import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { enhanceText } from '../../../../lib/voiceApi';
import { getTextDirection } from '../../../../utils/textDirection';

type Phase = 'loading' | 'edited' | 'kept' | 'error';

type EnhanceTextModalProps = {
  text: string;
  onUse: (enhanced: string) => void;
  onClose: () => void;
};

/**
 * On-demand text enhancement. Opens already firing the cleanup request, then
 * shows the model's candidate in an editable textarea. The user reviews, tweaks
 * if needed, and applies it to replace the composer input — no automatic
 * validation, the user is the gatekeeper.
 */
const EnhanceTextModal = ({ text, onUse, onClose }: EnhanceTextModalProps) => {
  const { t } = useTranslation('chat');
  const [phase, setPhase] = useState<Phase>('loading');
  const [enhancedText, setEnhancedText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Keep the latest text in a ref so a single effect fires the request on mount
  // without re-running when the parent's input changes mid-request.
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setPhase('loading');
    enhanceText(textRef.current, { signal: controller.signal })
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'edited') {
          setEnhancedText(result.text);
          setPhase('edited');
        } else if (result.status === 'kept') {
          setPhase('kept');
        } else {
          setErrorMsg(result.message);
          setPhase('error');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMsg(t('enhanceFailed', { defaultValue: 'Enhance failed.' }));
          setPhase('error');
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const body = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="enhance-modal-title"
    >
      <div
        className="bidi-isolate flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="enhance-modal-title"
          dir={getTextDirection(text)}
          className="mb-4 text-lg font-semibold text-foreground"
        >
          {t('enhanceTitle', { defaultValue: 'Enhance text' })}
        </h2>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {phase === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('enhancing', { defaultValue: 'Enhancing…' })}
            </div>
          )}

          {phase === 'kept' && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {t('enhanceNoChanges', { defaultValue: 'No changes needed.' })}
            </p>
          )}

          {phase === 'error' && (
            <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              {errorMsg}
            </div>
          )}

          {phase === 'edited' && (
            <textarea
              dir={getTextDirection(enhancedText)}
              className="bidi-isolate min-h-64 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              value={enhancedText}
              onChange={(event) => setEnhancedText(event.target.value)}
              autoFocus
            />
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            {t('enhanceCancel', { defaultValue: 'Cancel' })}
          </button>
          {phase === 'edited' && (
            <button
              type="button"
              onClick={() => onUse(enhancedText)}
              disabled={!enhancedText.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('enhanceUse', { defaultValue: 'Use' })}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(body, document.body);
};

export default EnhanceTextModal;
