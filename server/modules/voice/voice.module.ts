import voiceProxyRouter from './voice-proxy.js';

/**
 * Voice router assembled for the server entrypoint.
 *
 * The proxy router is a functional superset of the earlier service/router
 * split: besides /health, /transcribe and /tts it carries STT context
 * (prompt/languages/terms), the /cleanup endpoint backed by provider profiles,
 * and an outbound-URL allowlist on top of the protocol check. Multer is loaded
 * lazily inside it, so importing this module does not pull in the upload stack
 * for deployments that never use voice.
 */
export const voiceRoutes = voiceProxyRouter;
