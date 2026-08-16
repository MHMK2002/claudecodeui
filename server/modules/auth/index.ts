// authRoutes: used by the server entrypoint to mount public authentication endpoints.
export { authRoutes } from './auth.module.js';

// authenticateToken: used by the server entrypoint to protect authenticated API modules.
export { authenticateToken } from './auth.middleware.js';
// createAuthBoundary: used by mode-boundary integration tests with isolated user stores.
export { createAuthBoundary } from './auth.middleware.js';
// authenticateWebSocket: used by WebSocket setup to verify connection tokens.
export { authenticateWebSocket } from './auth.middleware.js';
// validateApiKey: used by the server entrypoint for optional API-wide key validation.
export { validateApiKey } from './auth.middleware.js';

// External API-key compatibility middleware for explicitly external endpoints.
// Product REST modules use authenticateToken instead.
export { validateExternalApiKeyOrJwt, validateExternalApiKey } from './api-key.js';
// generateToken: used by Auth services and tests to mint a UI-equivalent JWT.
export { generateToken } from './auth.middleware.js';
