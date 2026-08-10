import { authenticatedFetch } from '../utils/api';
import {
  DEFAULT_CLEANUP_PROMPT,
  readVoiceConfig,
  voiceConfigHeaders,
  type VoiceConfig,
} from '../hooks/useVoiceConfig';
import { IS_PLATFORM } from '../constants/config';
import {
  CLEANUP_TEXT_MAX_CHARS,
  normalizeCleanupInstructions,
  parseCleanupDecision,
} from '../../shared/voice-cleanup-contract';
import { isUnsupportedSttContextError } from '../../shared/voice-stt-context';

export const VOICE_CLEANUP_TIMEOUT_MS = 10000;

export type EnhanceResult =
  | { status: 'edited'; text: string }
  | { status: 'kept' }
  | { status: 'error'; message: string };

export type EnhanceTextOptions = {
  signal?: AbortSignal;
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
 * On-demand text enhancement. POSTs the raw text to the cleanup service and
 * returns the model's candidate for the user to review and apply manually.
 * No masking, no automatic validation — the user is the gatekeeper via the
 * Enhance modal.
 */
export async function enhanceText(
  text: string,
  options: EnhanceTextOptions = {},
): Promise<EnhanceResult> {
  const config = readVoiceConfig();
  if (!config.cleanupEnabled) return { status: 'error', message: 'Cleanup is disabled.' };
  if (!text.trim() || text.length > CLEANUP_TEXT_MAX_CHARS) {
    return { status: 'error', message: 'Nothing to enhance.' };
  }
  if (options.signal?.aborted) return { status: 'error', message: 'Cancelled.' };

  const instructions = normalizeCleanupInstructions(
    config.cleanupPrompt,
    DEFAULT_CLEANUP_PROMPT,
  );
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
    const res = await authenticatedFetch('/api/voice/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        mode: 'clean_transcript',
        providerProfileId: config.cleanupProviderProfileId,
        model: config.cleanupModel,
        instructions,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { status: 'error', message: 'Enhance request failed.' };
    const data = await res.json().catch(() => null);
    const decision =
      res.headers.get('X-Voice-Cleanup-Outcome') === 'invalid_schema'
        ? null
        : parseCleanupDecision(data);

    if (options.signal?.aborted) return { status: 'error', message: 'Cancelled.' };
    if (!decision) return { status: 'error', message: 'Enhance returned an invalid response.' };
    if (decision.action === 'keep') return { status: 'kept' };
    return { status: 'edited', text: decision.text };
  } catch {
    if (options.signal?.aborted) {
      return { status: 'error', message: timedOut ? 'Enhance timed out.' : 'Cancelled.' };
    }
    return { status: 'error', message: 'Enhance request failed.' };
  } finally {
    globalThis.clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
