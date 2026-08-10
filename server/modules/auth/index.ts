// authRoutes: used by the server entrypoint to mount public authentication endpoints.
export { authRoutes } from './auth.module.js';

// authenticateToken: used by the server entrypoint to protect authenticated API modules.
export { authenticateToken } from './auth.middleware.js';
// authenticateWebSocket: used by WebSocket setup to verify connection tokens.
export { authenticateWebSocket } from './auth.middleware.js';
// validateApiKey: used by the server entrypoint for optional API-wide key validation.
export { validateApiKey } from './auth.middleware.js';

// validateExternalApiKeyOrJwt / validateExternalApiKey: used by Scheduled-runs and
// Agent routes, which authenticate with an external API key (or the UI's JWT)
// rather than the session cookie flow authenticateToken covers.
export { validateExternalApiKeyOrJwt, validateExternalApiKey } from './api-key.js';
// generateToken: used by Scheduled-runs route tests to mint a UI-equivalent JWT.
export { generateToken } from './auth.middleware.js';
