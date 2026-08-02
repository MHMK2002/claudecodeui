import { authenticatedFetch } from '../utils/api';
import { DEFAULT_CLEANUP_PROMPT, readVoiceConfig, voiceConfigHeaders } from '../hooks/useVoiceConfig';
import { IS_PLATFORM } from '../constants/config';

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

/**
 * Uploads a finished recording for transcription. Not used for the 'soniox'
 * provider — that streams live over the /voice-stream WebSocket relay
 * (see useVoiceInput.ts) instead of uploading a completed blob.
 */
export function transcribeVoice(blob: Blob, filename: string): Promise<Response> {
  const config = readVoiceConfig();
  const body = new FormData();

  if (config.baseUrl.trim()) {
    body.append('file', blob, filename);
    body.append('model', config.sttModel || 'whisper-1');
    return fetch(directUrl(config.baseUrl.trim(), '/audio/transcriptions'), {
      method: 'POST',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      body,
    });
  }

  body.append('audio', blob, filename);
  return authenticatedFetch('/api/voice/transcribe', {
    method: 'POST',
    headers: voiceConfigHeaders(),
    body,
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
 * Optional transcript cleanup: runs the raw STT text through the backend's
 * /chat/completions endpoint with the user's configurable cleanup prompt. No-op
 * (returns the input unchanged) when cleanup is disabled. Fails soft — any
 * network/model error returns the original text so dictation is never blocked.
 */
export async function cleanupVoiceTranscript(text: string): Promise<string> {
  const config = readVoiceConfig();
  if (!config.cleanupEnabled) return text;

  const prompt = config.cleanupPrompt.trim() || DEFAULT_CLEANUP_PROMPT;
  const model = config.cleanupModel.trim() || 'gpt-4o-mini';

  try {
    if (config.baseUrl.trim()) {
      const res = await fetch(directUrl(config.baseUrl.trim(), '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: text },
          ],
          temperature: 0,
        }),
      });
      if (!res.ok) throw new Error(`cleanup ${res.status}`);
      const data = await res.json();
      const cleaned = String(data?.choices?.[0]?.message?.content ?? '').trim();
      return cleaned || text;
    }

    const res = await authenticatedFetch('/api/voice/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...voiceConfigHeaders() },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`cleanup ${res.status}`);
    const data = await res.json();
    const cleaned = String(data?.text ?? '').trim();
    return cleaned || text;
  } catch {
    return text;
  }
}
