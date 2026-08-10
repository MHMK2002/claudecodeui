// Optional voice proxy — forwards STT/TTS to an OpenAI-compatible audio backend.
//
// The backend is whatever the user points at: OpenAI, Groq, or a local server
// (LocalAI / Speaches / Kokoro-FastAPI / openedai-speech / etc.). It must expose the
// standard OpenAI audio endpoints:
//     POST {base}/audio/transcriptions   (multipart 'file' + 'model')      -> { text }
//     POST {base}/audio/speech           ({ model, voice, input })         -> audio bytes
//
// Config is resolved per-request from headers (set by the client's voice settings),
// falling back to server env defaults. Mounted at /api/voice behind authenticateToken.
import { Readable } from 'node:stream';

import express from 'express';

import {
  CLEANUP_TEXT_MAX_CHARS,
  DEFAULT_CODEX_CLEANUP_MODEL,
  DEFAULT_CLEANUP_GUIDANCE,
  normalizeCleanupInstructions,
  normalizeCleanupModel,
} from '../shared/voice-cleanup-contract.js';
import { isUnsupportedSttContextError } from '../shared/voice-stt-context.js';

import {
  CodexVoiceCleanupError,
  codexVoiceCleanupService,
} from './modules/providers/list/codex/codex-voice-cleanup.service.js';

const ENV = {
  baseUrl: (process.env.VOICE_API_BASE_URL || '').replace(/\/$/, ''),
  apiKey: process.env.VOICE_API_KEY || '',
  sttModel: process.env.VOICE_STT_MODEL || 'whisper-1',
  ttsModel: process.env.VOICE_TTS_MODEL || 'tts-1',
  ttsVoice: process.env.VOICE_TTS_VOICE || 'alloy',
};

const STT_PROMPT_MAX_CHARS = 4000;
const STT_LANGUAGE_MAX_ITEMS = 2;
const STT_TERM_MAX_ITEMS = 100;
const STT_TERM_MAX_CHARS = 128;
const LANGUAGE_HINT_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i;

function parseArrayField(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeStringList(value, { maxItems, maxChars, normalize, isValid }) {
  const seen = new Set();
  const result = [];
  for (const item of parseArrayField(value)) {
    if (typeof item !== 'string') continue;
    const normalized = normalize(item.trim());
    if (!normalized || normalized.length > maxChars || !isValid(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

export function normalizeVoiceSttContext(body = {}) {
  const prompt = typeof body.sttPrompt === 'string'
    ? body.sttPrompt.trim().slice(0, STT_PROMPT_MAX_CHARS)
    : '';
  const languages = normalizeStringList(body.sttLanguages, {
    maxItems: STT_LANGUAGE_MAX_ITEMS,
    maxChars: 16,
    normalize: (value) => value.toLowerCase(),
    isValid: (value) => LANGUAGE_HINT_PATTERN.test(value),
  });
  const terms = normalizeStringList(body.sttTerms, {
    maxItems: STT_TERM_MAX_ITEMS,
    maxChars: STT_TERM_MAX_CHARS,
    normalize: (value) => value,
    isValid: (value) => !/[<>\r\n]/.test(value),
  });
  return { prompt, languages, terms };
}

function hasSttContext(context) {
  return Boolean(context.prompt || context.languages.length || context.terms.length);
}

export { isUnsupportedSttContextError };

/**
 * Resolve the voice backend config for a request. Client headers (set from the
 * user's in-app voice settings) take precedence over the server env defaults.
 * Soniox is not resolved here — it streams over the /voice-stream WebSocket relay
 * (server/modules/websocket/services/voice-stream-proxy.service.ts), which resolves
 * its own key independently.
 * @param {import('express').Request} req
 * @returns {{baseUrl: string, apiKey: string, sttModel: string, ttsModel: string, ttsVoice: string, ttsFormat: string}}
 */
function resolveConfig(req) {
  const h = req.headers;
  return {
    // Security: do not allow clients to control the outbound backend host.
    // Always use the server-side configured base URL.
    baseUrl: ENV.baseUrl,
    apiKey: String(h['x-voice-api-key'] || '') || ENV.apiKey,
    sttModel: String(h['x-voice-stt-model'] || '') || ENV.sttModel,
    ttsModel: String(h['x-voice-tts-model'] || '') || ENV.ttsModel,
    ttsVoice: String(h['x-voice-tts-voice'] || '') || ENV.ttsVoice,
    ttsFormat: String(h['x-voice-tts-format'] || '').trim(),
  };
}

const router = express.Router();

// Generous by default — local TTS can synthesize long messages at ~real-time on CPU.
// Guard against a non-numeric/zero override that would make setTimeout fire immediately.
const DEFAULT_VOICE_TIMEOUT_MS = 300000;
const _parsedTimeout = Number(process.env.VOICE_TIMEOUT_MS);
const VOICE_TIMEOUT_MS = Number.isFinite(_parsedTimeout) && _parsedTimeout > 0
  ? _parsedTimeout
  : DEFAULT_VOICE_TIMEOUT_MS;
/**
 * fetch() with an AbortController timeout so a stalled backend can't hold the
 * request open indefinitely. Aborts after VOICE_TIMEOUT_MS.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = VOICE_TIMEOUT_MS) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || !isAllowedBackendUrl(parsed.origin)) {
    throw new Error('Blocked outbound voice backend URL');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(parsed.toString(), { redirect: 'manual', ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Keep the timeout active until a text response body is fully consumed. */
export async function fetchTextWithTimeout(url, options = {}, timeoutMs = VOICE_TIMEOUT_MS) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || !isAllowedBackendUrl(parsed.origin)) {
    throw new Error('Blocked outbound voice backend URL');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed.toString(), {
      redirect: 'manual',
      ...options,
      signal: controller.signal,
    });
    return { response, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a backend fetch failure into a clear, actionable client response:
 * 504 on timeout (AbortError), 502 otherwise.
 * @param {import('express').Response} res
 * @param {Error} e
 */
function backendError(res, e, timeoutMs = VOICE_TIMEOUT_MS) {
  if (e && e.name === 'AbortError') {
    return res.status(504).json({
      error: `Voice backend timed out after ${Math.round(timeoutMs / 1000)}s. Check your voice backend.`,
    });
  }
  return res.status(502).json({ error: `Voice backend unreachable: ${e.message}` });
}

/**
 * SSRF guard for the user-configurable backend URL: allow http/https only and
 * block the link-local / cloud-metadata range (169.254.x). localhost and private
 * ranges are allowed on purpose so users can point at a local voice server
 * (LocalAI, Speaches, Kokoro-FastAPI, etc.).
 * @param {string} raw
 * @returns {boolean}
 */
function isAllowedBackendUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.hostname === '169.254.169.254' || u.hostname.startsWith('169.254.')) return false;
  return true;
}

/**
 * Relay an upstream (backend) error to the client without making an upstream
 * 401/403 look like the user's own app login failed.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} [text]
 */
function upstreamError(res, status, text) {
  if (status === 401 || status === 403) {
    return res.status(502).json({ error: 'Voice backend rejected the request (check the API key).' });
  }
  return res.status(status).json({ error: text || 'voice backend error' });
}

let _upload = null;
/**
 * Lazily build a memory-storage multer instance (25 MB cap) for audio uploads,
 * so multer is only imported when the voice feature is actually used.
 * @returns {Promise<import('multer').Multer>}
 */
async function getUpload() {
  if (!_upload) {
    const multer = (await import('multer')).default;
    _upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
  }
  return _upload;
}

/**
 * Build the Authorization header for the backend, or an empty object when no
 * key is configured (e.g. a local server that needs none).
 * @param {string} apiKey
 * @returns {Record<string, string>}
 */
function authHeader(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export function buildTranscriptionBody(file, cfg, context, includeContext) {
  const fd = new FormData();
  fd.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype || 'audio/webm' }),
    file.originalname || 'recording.webm',
  );
  fd.append('model', cfg.sttModel);
  if (includeContext) {
    if (context.prompt) fd.append('prompt', context.prompt);
    for (const term of context.terms) fd.append('keywords[]', term);
    for (const language of context.languages) fd.append('languages[]', language);
  }
  return fd;
}

/**
 * GET /api/voice/health -> { configured } (true when a backend base URL is set).
 */
router.get('/health', (req, res) => {
  res.json({ configured: Boolean(resolveConfig(req).baseUrl) });
});

/**
 * POST /api/voice/transcribe (multipart 'audio') -> { text }.
 * Forwards the uploaded audio to the backend's /audio/transcriptions endpoint.
 */
router.post('/transcribe', async (req, res) => {
  const cfg = resolveConfig(req);
  if (!cfg.baseUrl) return res.status(503).json({ error: 'No voice backend configured' });
  if (!isAllowedBackendUrl(cfg.baseUrl)) return res.status(400).json({ error: 'Invalid voice backend URL.' });
  const upload = await getUpload();
  upload.single('audio')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });
    try {
      const context = normalizeVoiceSttContext(req.body);
      const includeContext = hasSttContext(context);
      let r = await fetchWithTimeout(`${cfg.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: authHeader(cfg.apiKey),
        body: buildTranscriptionBody(req.file, cfg, context, includeContext),
      });
      let text = await r.text();
      if (includeContext && !r.ok && isUnsupportedSttContextError(r.status, text)) {
        r = await fetchWithTimeout(`${cfg.baseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: authHeader(cfg.apiKey),
          body: buildTranscriptionBody(req.file, cfg, context, false),
        });
        text = await r.text();
      }
      if (!r.ok) return upstreamError(res, r.status, text);
      let data;
      try { data = JSON.parse(text); } catch { data = { text }; }
      res.json({ text: data.text ?? '' });
    } catch (e) {
      backendError(res, e);
    }
  });
});

/**
 * POST /api/voice/tts { text } -> audio bytes.
 * Forwards the text to the backend's /audio/speech endpoint and streams the audio back.
 */
router.post('/tts', async (req, res) => {
  const cfg = resolveConfig(req);
  if (!cfg.baseUrl) return res.status(503).json({ error: 'No voice backend configured' });
  if (!isAllowedBackendUrl(cfg.baseUrl)) return res.status(400).json({ error: 'Invalid voice backend URL.' });
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text required' });
  try {
    const r = await fetchWithTimeout(`${cfg.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(cfg.apiKey) },
      body: JSON.stringify({
        model: cfg.ttsModel,
        voice: cfg.ttsVoice,
        input: text,
        ...(cfg.ttsFormat ? { response_format: cfg.ttsFormat } : {}),
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => 'tts failed');
      return upstreamError(res, r.status, errText);
    }
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    if (!r.body) return res.end();
    Readable.fromWeb(r.body).on('error', (error) => res.destroy(error)).pipe(res);
  } catch (e) {
    backendError(res, e);
  }
});

/**
 * POST /api/voice/cleanup { text, mode, providerProfileId?, model?, instructions? }
 * -> CleanupDecision. Credentials and provider URLs are resolved server-side;
 * the browser can only select an owned Codex profile and supported model.
 */
router.post('/cleanup', async (req, res) => {
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim() || text.length > CLEANUP_TEXT_MAX_CHARS) {
    return res.status(400).json({ error: 'valid text required' });
  }
  const mode = req.body?.mode ?? 'clean_transcript';
  if (mode !== 'clean_transcript') return res.status(400).json({ error: 'invalid cleanup mode' });

  const rawUserId = req.user?.id ?? req.user?.userId;
  const userId = typeof rawUserId === 'number'
    ? rawUserId
    : typeof rawUserId === 'string' && /^\d+$/.test(rawUserId.trim())
      ? Number(rawUserId.trim())
      : NaN;
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: 'Authenticated user required' });
  }

  const rawProfileId = req.body?.providerProfileId;
  const providerProfileId = rawProfileId === undefined || rawProfileId === null
    ? null
    : typeof rawProfileId === 'number'
      ? rawProfileId
      : typeof rawProfileId === 'string' && /^\d+$/.test(rawProfileId.trim())
        ? Number(rawProfileId.trim())
        : NaN;
  if (providerProfileId !== null && (!Number.isInteger(providerProfileId) || providerProfileId <= 0)) {
    return res.status(400).json({ error: 'invalid Codex provider profile' });
  }

  const model = normalizeCleanupModel(req.body?.model, DEFAULT_CODEX_CLEANUP_MODEL);
  const instructions = normalizeCleanupInstructions(req.body?.instructions, DEFAULT_CLEANUP_GUIDANCE);
  const controller = new AbortController();
  const abortOnRequest = () => controller.abort();
  const abortOnResponseClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once('aborted', abortOnRequest);
  res.once('close', abortOnResponseClose);

  try {
    const result = await codexVoiceCleanupService.cleanup({
      userId,
      providerProfileId,
      model,
      transcript: text,
      instructions,
      signal: controller.signal,
    });
    res.setHeader('X-Voice-Cleanup-Outcome', 'model_decision');
    res.setHeader('X-Voice-Cleanup-Model', result.model);
    if (result.inputTokens !== null) {
      res.setHeader('X-Voice-Cleanup-Input-Tokens', String(result.inputTokens));
    }
    return res.json(result.decision);
  } catch (error) {
    if (res.destroyed || res.headersSent) return undefined;
    if (error instanceof CodexVoiceCleanupError) {
      return res.status(error.statusCode).json({
        error: 'Codex transcript cleanup failed.',
        code: error.code,
      });
    }
    return res.status(502).json({ error: 'Codex transcript cleanup failed.' });
  } finally {
    req.removeListener('aborted', abortOnRequest);
    res.removeListener('close', abortOnResponseClose);
  }
});

export default router;
