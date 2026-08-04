import { authenticatedFetch } from '../utils/api';
import {
  DEFAULT_CLEANUP_PROMPT,
  readVoiceConfig,
  voiceConfigHeaders,
  type VoiceConfig,
} from '../hooks/useVoiceConfig';
import { IS_PLATFORM } from '../constants/config';
import {
  buildCleanupMessages,
  CLEANUP_TEXT_MAX_CHARS,
  normalizeCleanupInstructions,
  normalizeCleanupModel,
  parseCleanupDecision,
  type CleanupDecision,
} from '../../shared/voice-cleanup-contract';
import { isUnsupportedSttContextError } from '../../shared/voice-stt-context';

import { prepareVoiceCleanup, validateAndRestoreVoiceCleanup } from './voiceCleanupGuard';

export const VOICE_CLEANUP_TIMEOUT_MS = 10000;

export type VoiceCleanupOutcome =
  | 'disabled'
  | 'ineligible'
  | 'kept'
  | 'edited'
  | 'invalid_schema'
  | 'unsafe_edit'
  | 'timeout'
  | 'cancelled'
  | 'request_failed';

export type CleanupVoiceTranscriptOptions = {
  signal?: AbortSignal;
  /** Content-free outcome hook for future local telemetry and benchmark wiring. */
  onOutcome?: (outcome: VoiceCleanupOutcome) => void;
  /** Test seam; production callers use VOICE_CLEANUP_TIMEOUT_MS. */
  timeoutMs?: number;
};

function directUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * URL for the real-time Soniox STT relay (server/modules/websocket/services/
 * voice-stream-proxy.service.ts). Mirrors getShellWebSocketUrl's auth handling:
 * platform mode needs no token, otherwise the JWT rides along as a query param
 * (a native WebSocket can't set an Authorization header).
 */
export function getVoiceStreamWebSocketUrl(): string | null {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (IS_PLATFORM) {
    return `${protocol}//${window.location.host}/voice-stream`;
  }

  const token = localStorage.getItem('auth-token');
  if (!token) {
    console.error('No authentication token found for voice stream WebSocket connection');
    return null;
  }

  return `${protocol}//${window.location.host}/voice-stream?token=${encodeURIComponent(token)}`;
}

export function voiceConfigSignature(): string {
  return JSON.stringify(readVoiceConfig());
}

function hasSttContext(config: VoiceConfig): boolean {
  return Boolean(config.sttPrompt || config.sttLanguages.length || config.sttTerms.length);
}

function appendDirectSttContext(body: FormData, config: VoiceConfig): void {
  if (config.sttPrompt) body.append('prompt', config.sttPrompt);
  for (const term of config.sttTerms) body.append('keywords[]', term);
  for (const language of config.sttLanguages) body.append('languages[]', language);
}

function appendProxySttContext(body: FormData, config: VoiceConfig): void {
  if (config.sttPrompt) body.append('sttPrompt', config.sttPrompt);
  if (config.sttTerms.length) body.append('sttTerms', JSON.stringify(config.sttTerms));
  if (config.sttLanguages.length) body.append('sttLanguages', JSON.stringify(config.sttLanguages));
}

export { isUnsupportedSttContextError };

export function buildDirectTranscriptionBody(
  blob: Blob,
  filename: string,
  config: VoiceConfig,
  includeContext: boolean,
): FormData {
  const body = new FormData();
  body.append('file', blob, filename);
  body.append('model', config.sttModel || 'whisper-1');
  if (includeContext) appendDirectSttContext(body, config);
  return body;
}

export function buildProxyTranscriptionBody(
  blob: Blob,
  filename: string,
  config: VoiceConfig,
): FormData {
  const body = new FormData();
  body.append('audio', blob, filename);
  appendProxySttContext(body, config);
  return body;
}

/**
 * Uploads a finished recording for transcription. Not used for the 'soniox'
 * provider — that streams live over the /voice-stream WebSocket relay
 * (see useVoiceInput.ts) instead of uploading a completed blob.
 */
export async function transcribeVoice(
  blob: Blob,
  filename: string,
  signal?: AbortSignal,
): Promise<Response> {
  const config = readVoiceConfig();

  if (config.baseUrl.trim()) {
    const url = directUrl(config.baseUrl.trim(), '/audio/transcriptions');
    const headers: Record<string, string> = config.apiKey
      ? { Authorization: `Bearer ${config.apiKey}` }
      : {};
    const includeContext = hasSttContext(config);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: buildDirectTranscriptionBody(blob, filename, config, includeContext),
      signal,
    });
    if (!includeContext || response.ok) return response;
    const errorText = await response.clone().text().catch(() => '');
    if (!isUnsupportedSttContextError(response.status, errorText)) return response;
    return fetch(url, {
      method: 'POST',
      headers,
      body: buildDirectTranscriptionBody(blob, filename, config, false),
      signal,
    });
  }

  return authenticatedFetch('/api/voice/transcribe', {
    method: 'POST',
    headers: voiceConfigHeaders(),
    body: buildProxyTranscriptionBody(blob, filename, config),
    signal,
  });
}

export function synthesizeVoice(text: string, signal: AbortSignal): Promise<Response> {
  const config = readVoiceConfig();

  if (config.baseUrl.trim()) {
    return fetch(directUrl(config.baseUrl.trim(), '/audio/speech'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.ttsModel || 'tts-1',
        voice: config.ttsVoice || 'alloy',
        input: text,
        ...(config.ttsFormat.trim() ? { response_format: config.ttsFormat.trim() } : {}),
      }),
      signal,
    });
  }

  return authenticatedFetch('/api/voice/tts', {
    method: 'POST',
    body: JSON.stringify({ text }),
    headers: voiceConfigHeaders(),
    signal,
  });
}

/**
 * Optional stateless transcript cleanup. Sensitive spans are masked before the
 * request and restored only after a conservative edit passes deterministic
 * validation. Every failure path returns the exact input string unchanged.
 */
export async function cleanupVoiceTranscript(
  text: string,
  options: CleanupVoiceTranscriptOptions = {},
): Promise<string> {
  const config = readVoiceConfig();
  const finish = (outcome: VoiceCleanupOutcome, result = text): string => {
    try {
      options.onOutcome?.(outcome);
    } catch {
      // Outcome reporting must never block dictation delivery.
    }
    return result;
  };
  if (!config.cleanupEnabled) return finish('disabled');
  if (!text.trim() || text.length > CLEANUP_TEXT_MAX_CHARS) return finish('ineligible');
  if (options.signal?.aborted) return finish('cancelled');

  const instructions = normalizeCleanupInstructions(
    config.cleanupPrompt,
    DEFAULT_CLEANUP_PROMPT,
  );
  const model = normalizeCleanupModel(config.cleanupModel, 'gpt-4o-mini');
  const prepared = prepareVoiceCleanup(text);
  if (prepared.maskedText.length > CLEANUP_TEXT_MAX_CHARS) return finish('ineligible');
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = options.timeoutMs ?? VOICE_CLEANUP_TIMEOUT_MS;
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let decision: CleanupDecision | null = null;
    if (config.baseUrl.trim()) {
      const res = await fetch(directUrl(config.baseUrl.trim(), '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: buildCleanupMessages(prepared.maskedText, instructions),
          temperature: 0,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return finish('request_failed');
      const data = await res.json().catch(() => null);
      decision = parseCleanupDecision(data?.choices?.[0]?.message?.content);
    } else {
      const res = await authenticatedFetch('/api/voice/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...voiceConfigHeaders() },
        body: JSON.stringify({
          text: prepared.maskedText,
          mode: 'clean_transcript',
          model,
          instructions,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return finish('request_failed');
      const data = await res.json().catch(() => null);
      decision = res.headers.get('X-Voice-Cleanup-Outcome') === 'invalid_schema'
        ? null
        : parseCleanupDecision(data);
    }

    if (options.signal?.aborted) return finish('cancelled');
    if (!decision) return finish('invalid_schema');
    if (decision.action === 'keep') return finish('kept');
    const validated = validateAndRestoreVoiceCleanup(prepared, decision.text);
    return validated.accepted
      ? finish('edited', validated.text)
      : finish('unsafe_edit');
  } catch {
    if (options.signal?.aborted) return finish('cancelled');
    return finish(timedOut ? 'timeout' : 'request_failed');
  } finally {
    globalThis.clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
