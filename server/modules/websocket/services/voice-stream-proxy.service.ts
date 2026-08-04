import { WebSocket, type RawData } from 'ws';

// Real-time STT relay: browser <-> our server <-> Soniox's streaming WebSocket API
// (wss://stt-rt.soniox.com/transcribe-websocket). A relay is required because a
// native browser WebSocket can't set custom headers, so the API key can't be sent
// the way the REST voice routes do (x-soniox-api-key header) — it's sent instead as
// the client's first WS message, resolved here (falling back to the server env key)
// and never forwarded to the browser.
const SONIOX_RT_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const SONIOX_RT_MODEL = process.env.SONIOX_STT_RT_MODEL || 'stt-rt-v5';
const ENV_SONIOX_API_KEY = process.env.SONIOX_API_KEY || '';

type ClientConfigMessage = {
  apiKey?: string;
  languageHints?: unknown;
  terms?: unknown;
};

const LANGUAGE_HINT_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i;

function normalizeClientList(
  value: unknown,
  options: { maxItems: number; maxChars: number; maxTotalChars: number; languageCodes?: boolean },
): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  let totalChars = 0;
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = options.languageCodes ? item.trim().toLowerCase() : item.trim();
    if (
      !normalized ||
      normalized.length > options.maxChars ||
      totalChars + normalized.length > options.maxTotalChars ||
      /[<>\r\n]/.test(normalized) ||
      (options.languageCodes && !LANGUAGE_HINT_PATTERN.test(normalized)) ||
      seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    totalChars += normalized.length;
    if (result.length >= options.maxItems) break;
  }
  return result;
}

export function buildSonioxStartRequest(apiKey: string, cfg: ClientConfigMessage): Record<string, unknown> {
  const languageHints = normalizeClientList(cfg.languageHints, {
    maxItems: 2,
    maxChars: 16,
    maxTotalChars: 32,
    languageCodes: true,
  });
  const terms = normalizeClientList(cfg.terms, {
    maxItems: 100,
    maxChars: 128,
    maxTotalChars: 8000,
  });
  return {
    api_key: apiKey,
    model: SONIOX_RT_MODEL,
    audio_format: 'auto',
    enable_language_identification: true,
    ...(languageHints.length ? { language_hints: languageHints } : {}),
    ...(terms.length ? { context: { terms } } : {}),
  };
}

/**
 * Relays one client's dictation session to Soniox's real-time STT WebSocket.
 *
 * Protocol with the client: first message is a JSON config frame ({ apiKey? }),
 * every message after that is forwarded upstream as-is (binary audio chunks, then
 * an empty frame to signal end-of-audio). Every message from Soniox — token
 * frames, the final { finished: true } frame, error frames — is relayed straight
 * back down to the client unchanged.
 */
export function handleVoiceStreamConnection(clientWs: WebSocket): void {
  let upstream: WebSocket | null = null;
  let configured = false;
  const pending: RawData[] = [];

  const closeBoth = (clientCode?: number, clientReason?: string) => {
    if (upstream && upstream.readyState === WebSocket.OPEN) upstream.close();
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close(clientCode, clientReason);
  };

  clientWs.on('message', (data: RawData, isBinary: boolean) => {
    if (!configured) {
      configured = true;
      let cfg: ClientConfigMessage = {};
      try {
        cfg = JSON.parse(data.toString('utf8'));
      } catch {
        // Malformed config frame: fall through with no client-supplied key, so the
        // env key (if any) still gets a chance below.
      }
      const apiKey = String(cfg.apiKey || '') || ENV_SONIOX_API_KEY;
      if (!apiKey) {
        clientWs.send(JSON.stringify({ error: 'No Soniox API key configured' }));
        clientWs.close(4401, 'No API key');
        return;
      }

      upstream = new WebSocket(SONIOX_RT_URL);

      upstream.on('open', () => {
        upstream!.send(JSON.stringify(buildSonioxStartRequest(apiKey, cfg)));
        // Flush audio chunks the client sent while the upstream connection/config
        // handshake was still in flight, in the order they arrived. Only ever audio
        // (the config frame took the early-return branch above), so binary is safe.
        for (const chunk of pending) upstream!.send(chunk, { binary: true });
        pending.length = 0;
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ ready: true }));
        }
      });

      // Soniox's token/finished/error responses are JSON TEXT frames. `ws.send()`
      // defaults to binary framing for Buffer payloads, so isBinary must be
      // forwarded explicitly — otherwise the client (binaryType: 'arraybuffer')
      // would silently receive these as ArrayBuffers instead of JSON strings.
      upstream.on('message', (raw: RawData, upstreamIsBinary: boolean) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw, { binary: upstreamIsBinary });
      });

      upstream.on('close', () => closeBoth());

      upstream.on('error', (error: Error) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ error: `Voice backend error: ${error.message}` }));
        }
        closeBoth(4502, 'Upstream error');
      });

      return;
    }

    // Already configured: relay audio (or the empty end-of-stream frame) upstream,
    // queuing it if the Soniox handshake hasn't finished yet.
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else if (upstream && upstream.readyState === WebSocket.CONNECTING) {
      pending.push(data);
    }
  });

  clientWs.on('close', () => closeBoth());
  clientWs.on('error', () => closeBoth());
}
