import { useCallback, useRef, useState } from 'react';

import { api, authenticatedFetch } from '../../../utils/api';
import type { ChatImage } from '../types/types';

interface UseEditLastUserMessageArgs {
  activeSessionId: string | null;
  /**
   * Sends a fresh `chat.send` against the active session. Mirrors the
   * composer submit path so the edited message goes through slash-command
   * interception and provider-native resume on the next turn.
   */
  sendMessage: (message: unknown) => void;
  /**
   * Build the websocket send options (model, effort, permissions) from
   * composer-level state. Reused verbatim from `useChatComposerState` so
   * edited messages dispatch with the same provider settings.
   */
  buildSendOptions: (content: string) => Record<string, unknown>;
  /**
   * Build a session summary notification from the new content. Mirrors
   * `getNotificationSessionSummary` in the composer for consistency.
   */
  buildSessionSummary?: (content: string) => string | null;
  /**
   * Mark the session as processing in the per-session activity map so the
   * header indicator stays in sync with the resubmitted turn.
   */
  onSessionProcessing?: (sessionId: string, info: { statusText: string | null; canInterrupt: boolean }) => void;
  scrollToBottom: () => void;
  setIsUserScrolledUp: (isUp: boolean) => void;
  /**
   * Surface a transient error message to the chat when the edit fails.
   * Accepts the same shape `useChatComposerState.addMessage` does so we
   * don't leak implementation details.
   */
  reportError: (message: string) => void;
}

interface EditTarget {
  messageId: string;
  initialContent: string;
  initialImages: ChatImage[];
}

export interface EditLastUserMessageController {
  target: EditTarget | null;
  pending: boolean;
  error: string | null;
  beginEdit: (messageId: string, content: string, images: ChatImage[]) => void;
  cancelEdit: () => void;
  confirmEdit: (nextContent: string, nextImages: ChatImage[]) => Promise<void>;
}

/** Shape returned by POST /api/assets/images (`buildStoredImageRecords`). */
type StoredImageRecord = { name: string; path: string; size: number; mimeType: string };

/**
 * Convert a `data:` URL into a File so it can be re-uploaded through the
 * same multipart endpoint the composer uses.
 */
async function dataUrlToFile(dataUrl: string, fallbackName: string): Promise<File | null> {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3];
  const ext = mimeType.split('/')[1] || 'bin';
  const name = `${fallbackName || 'image'}.${ext}`;

  let blob: Blob;
  if (isBase64) {
    const byteString = atob(payload);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
    blob = new Blob([bytes], { type: mimeType });
  } else {
    blob = new Blob([decodeURIComponent(payload)], { type: mimeType });
  }
  return new File([blob], name, { type: mimeType });
}

/** Upload one File to the global image store and return its stored record. */
async function uploadImageFile(file: File): Promise<StoredImageRecord | null> {
  const formData = new FormData();
  formData.append('images', file);
  try {
    const response = await authenticatedFetch('/api/assets/images', {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) return null;
    const result = (await response.json()) as { images?: StoredImageRecord[] };
    return result.images?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * `chat.send` only accepts image descriptors pointing at files inside the
 * upload store. History rows carry images either as an upload-store path
 * (pass through) or as an inline base64 data URL (re-upload to mint a path).
 * Anything we cannot resolve is dropped rather than blocking the resubmit.
 */
async function persistImagesForResubmit(images: ChatImage[]): Promise<StoredImageRecord[]> {
  const resolved: StoredImageRecord[] = [];
  for (const image of images) {
    if (image.path) {
      resolved.push({
        name: image.name || 'image',
        path: image.path,
        size: 0,
        mimeType: image.mimeType || 'image/png',
      });
      continue;
    }
    if (image.data) {
      const file = await dataUrlToFile(image.data, image.name || '');
      if (!file) continue;
      const stored = await uploadImageFile(file);
      if (stored) resolved.push(stored);
    }
  }
  return resolved;
}

/**
 * Edit-and-resubmit controller for the LAST user message. The flow:
 *
 * 1. PATCH `/api/providers/sessions/:id/messages/:messageId` (server-side
 *    creates and adopts a provider-native branch before the targeted prompt).
 * 2. Server broadcasts `session.rewound` — the realtime handler refreshes
 *    the slot, dropping the old user row and every assistant turn after it.
 * 3. Locally dispatch a `chat.send` so the provider runtime receives the new
 *    content (and re-persisted image attachments) and starts a fresh turn
 *    against the adopted branch.
 */
export function useEditLastUserMessage({
  activeSessionId,
  sendMessage,
  buildSendOptions,
  buildSessionSummary,
  onSessionProcessing,
  scrollToBottom,
  setIsUserScrolledUp,
  reportError,
}: UseEditLastUserMessageArgs): EditLastUserMessageController {
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Prevent double-fire when Esc + click race during in-flight request.
  const inflightRef = useRef(false);

  const beginEdit = useCallback((messageId: string, content: string, images: ChatImage[]) => {
    setError(null);
    setTarget({ messageId, initialContent: content, initialImages: images });
  }, []);

  const cancelEdit = useCallback(() => {
    if (inflightRef.current) return;
    setTarget(null);
    setPending(false);
    setError(null);
  }, []);

  const confirmEdit = useCallback(
    async (nextContent: string, nextImages: ChatImage[]) => {
      if (!activeSessionId || !target) return;
      if (inflightRef.current) return;
      const trimmed = nextContent.trim();
      if (!trimmed) return;
      inflightRef.current = true;
      setPending(true);
      setError(null);

      try {
        // chat.send only carries upload-store paths, so re-materialize any
        // inline base64 attachments before the resubmit.
        const storedImages = await persistImagesForResubmit(nextImages);

        const response = await api.editUserMessage(activeSessionId, target.messageId, {
          content: trimmed,
          images: storedImages,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string | { message?: string };
          } | null;
          const apiError = typeof payload?.error === 'string'
            ? payload.error
            : payload?.error?.message;
          throw new Error(apiError || 'Could not rewind this message.');
        }
        // Server broadcast already refreshed the slot; dispatch a fresh
        // chat.send so the provider runtime starts a new turn against the
        // provider-native branch.
        sendMessage({
          type: 'chat.send',
          sessionId: activeSessionId,
          content: trimmed,
          options: {
            ...buildSendOptions(trimmed),
            images: storedImages,
            sessionSummary: buildSessionSummary?.(trimmed) ?? undefined,
          },
        });

        onSessionProcessing?.(activeSessionId, {
          statusText: null,
          canInterrupt: true,
        });
        setIsUserScrolledUp(false);
        setTimeout(() => scrollToBottom(), 100);

        setTarget(null);
        setPending(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setPending(false);
        reportError(`Edit failed: ${message}`);
      } finally {
        inflightRef.current = false;
      }
    },
    [
      activeSessionId,
      target,
      sendMessage,
      buildSendOptions,
      buildSessionSummary,
      onSessionProcessing,
      scrollToBottom,
      setIsUserScrolledUp,
      reportError,
    ],
  );

  return { target, pending, error, beginEdit, cancelEdit, confirmEdit };
}
