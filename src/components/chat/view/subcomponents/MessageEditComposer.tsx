import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import type { ChatImage } from '../../types/types';
import { getTextDirection } from '../../../../utils/textDirection';

interface MessageEditComposerProps {
  initialContent: string;
  initialImages?: ChatImage[];
  pending: boolean;
  error?: string | null;
  onSubmit: (nextContent: string, nextImages: ChatImage[]) => void | Promise<void>;
  onCancel: () => void;
}

/** Resolve a ChatImage to an <img src>-friendly URL (data URL or asset route). */
function imageSource(image: ChatImage, fallbackName: string): string {
  if (image.data) return image.data;
  if (image.path) {
    const filename = image.path.split(/[\\/]/).pop() || fallbackName;
    return `/api/assets/images/${encodeURIComponent(filename)}`;
  }
  return '';
}

/**
 * Inline editor that replaces a user message bubble while the user rewrites
 * the turn. Mirrors the chat composer layout: a textarea with submit/cancel
 * controls and the same `dir="auto"` + `bidi-plaintext` pairing so Persian
 * prose, English identifiers, and code blocks all flow naturally.
 *
 * The original message's image attachments are carried as editable state:
 * each is shown as a thumbnail with a remove control, and the surviving set
 * is re-attached on submit (the hook re-persists base64 attachments into the
 * upload store before the resubmit).
 */
export default function MessageEditComposer({
  initialContent,
  initialImages,
  pending,
  error,
  onSubmit,
  onCancel,
}: MessageEditComposerProps) {
  const { t } = useTranslation('chat');
  const [value, setValue] = useState(initialContent);
  const [images, setImages] = useState<ChatImage[]>(initialImages ?? []);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setValue(initialContent);
  }, [initialContent]);

  useEffect(() => {
    setImages(initialImages ?? []);
  }, [initialImages]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    const length = node.value.length;
    node.setSelectionRange(length, length);
  }, []);

  const handleChange = useCallback((next: string) => {
    setValue(next);
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((current) => current.filter((_, i) => i !== index));
  }, []);

  const submit = useCallback(async () => {
    const next = value;
    if (!next.trim() || pending) return;
    await onSubmit(next, images);
  }, [onSubmit, pending, value, images]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
        event.preventDefault();
        void submit();
      }
    },
    [onCancel, submit],
  );

  return (
    <div className="group w-full rounded-2xl rounded-br-md bg-blue-600/95 px-3 py-2 text-white shadow-sm sm:px-4">
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((image, index) => {
            const src = imageSource(image, image.name || `image-${index + 1}`);
            if (!src) return null;
            return (
              <div key={`${src}-${index}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/30">
                <img src={src} alt={image.name || 'attachment'} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  disabled={pending}
                  className="absolute right-0 top-0 rounded-bl-md bg-black/60 p-0.5 text-white transition hover:bg-black/80 disabled:opacity-50"
                  aria-label={t('rewind.editRemoveImage', { defaultValue: 'Remove image' })}
                  title={t('rewind.editRemoveImage', { defaultValue: 'Remove image' })}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <textarea
        ref={textareaRef}
        dir={getTextDirection(value)}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={Math.min(8, Math.max(2, value.split('\n').length))}
        className="bidi-isolate block w-full resize-none border-0 bg-transparent text-sm leading-6 text-white placeholder:text-blue-100/60 focus:outline-none"
        placeholder={t('rewind.editPlaceholder', { defaultValue: 'Edit your message…' })}
      />
      {error && (
        <div className="mt-1 rounded border border-red-300/40 bg-red-500/15 px-2 py-1 text-xs text-red-50">
          {error}
        </div>
      )}
      <div className="mt-2 flex items-center justify-end gap-2 text-xs">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-white/30 px-2.5 py-1 font-medium text-white/90 transition hover:bg-white/10 disabled:opacity-50"
        >
          {t('rewind.editCancel', { defaultValue: 'Cancel' })}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending || !value.trim()}
          className="rounded-md bg-white px-3 py-1 font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
        >
          {pending
            ? t('rewind.editPending', { defaultValue: 'Saving…' })
            : t('rewind.editSubmit', { defaultValue: 'Save & submit' })}
        </button>
      </div>
    </div>
  );
}