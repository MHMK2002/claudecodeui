// scheduledRunsRoutes: used by the server entrypoint to mount the scheduled-runs
// API (it authenticates with an external API key or JWT, not authenticateToken).
export { default as scheduledRunsRoutes } from './scheduled-runs.routes.js';
// startScheduler/stopScheduler: used by the server entrypoint to run the 60s tick
// loop, which repairs runs orphaned by a prior crash before its first tick.
export { startScheduler, stopScheduler } from './scheduler.service.js';
