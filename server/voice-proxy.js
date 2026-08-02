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

// Default cleanup prompt kept in sync with src/hooks/useVoiceConfig.ts (DEFAULT_CLEANUP_PROMPT).
// Duplicated because the client and server are separate bundles.
const DEFAULT_CLEANUP_PROMPT =
  'Lightly clean up the transcribed speech. Fix punctuation and capitalization, remove filler words and false starts (um, uh, repeats), and fix obvious recognition errors. Preserve the original language and meaning. Do not translate, expand, or rewrite the content. Output only the cleaned text with no commentary.';

const ENV = {
  baseUrl: (process.env.VOICE_API_BASE_URL || '').replace(/\/$/, ''),
  apiKey: process.env.VOICE_API_KEY || '',
  sttModel: process.env.VOICE_STT_MODEL || 'whisper-1',
  ttsModel: process.env.VOICE_TTS_MODEL || 'tts-1',
  ttsVoice: process.env.VOICE_TTS_VOICE || 'alloy',
  cleanupModel: process.env.VOICE_CLEANUP_MODEL || 'gpt-4o-mini',
  cleanupPrompt: process.env.VOICE_CLEANUP_PROMPT || DEFAULT_CLEANUP_PROMPT,
};

/**
 * Resolve the voice backend config for a request. Client headers (set from the
 * user's in-app voice settings) take precedence over the server env defaults.
 * Soniox is not resolved here — it streams over the /voice-stream WebSocket relay
 * (server/modules/websocket/services/voice-stream-proxy.service.ts), which resolves
 * its own key independently.
 * @param {import('express').Request} req
 * @returns {{baseUrl: string, apiKey: string, sttModel: string, ttsModel: string, ttsVoice: string, ttsFormat: string, cleanup: boolean, cleanupModel: string, cleanupPrompt: string}}
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
    cleanup: String(h['x-voice-cleanup'] || '') === '1',
    cleanupModel: String(h['x-voice-cleanup-model'] || '') || ENV.cleanupModel,
    cleanupPrompt: String(h['x-voice-cleanup-prompt'] || '') || ENV.cleanupPrompt,
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
async function fetchWithTimeout(url, options = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || !isAllowedBackendUrl(parsed.origin)) {
    throw new Error('Blocked outbound voice backend URL');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_TIMEOUT_MS);
  try {
    return await fetch(parsed.toString(), { redirect: 'manual', ...options, signal: controller.signal });
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
function backendError(res, e) {
  if (e && e.name === 'AbortError') {
    return res.status(504).json({
      error: `Voice backend timed out after ${Math.round(VOICE_TIMEOUT_MS / 1000)}s. Check your voice backend.`,
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
      const fd = new FormData();
      fd.append(
        'file',
        new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }),
        req.file.originalname || 'recording.webm',
      );
      fd.append('model', cfg.sttModel);
      const r = await fetchWithTimeout(`${cfg.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: authHeader(cfg.apiKey),
        body: fd,
      });
      const text = await r.text();
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
 * POST /api/voice/cleanup { text } -> { text }.
 * Optional transcript polish step: runs the raw STT text through the backend's
 * /chat/completions endpoint with the configurable cleanup system prompt, so the
 * user gets lightly cleaned-up text (punctuation, filler words) instead of raw
 * ASR output. Reached only when the client sends x-voice-cleanup: 1. Falls back
 * to the original text if the model returns nothing.
 */
router.post('/cleanup', async (req, res) => {
  const cfg = resolveConfig(req);
  if (!cfg.baseUrl) return res.status(503).json({ error: 'No voice backend configured' });
  if (!isAllowedBackendUrl(cfg.baseUrl)) return res.status(400).json({ error: 'Invalid voice backend URL.' });
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text required' });
  try {
    const r = await fetchWithTimeout(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(cfg.apiKey) },
      body: JSON.stringify({
        model: cfg.cleanupModel,
        messages: [
          { role: 'system', content: cfg.cleanupPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0,
      }),
    });
    const body = await r.text();
    if (!r.ok) return upstreamError(res, r.status, body);
    let data;
    try { data = JSON.parse(body); } catch { data = {}; }
    const cleaned = String(data?.choices?.[0]?.message?.content ?? '').trim();
    res.json({ text: cleaned || text });
  } catch (e) {
    backendError(res, e);
  }
});

export default router;
