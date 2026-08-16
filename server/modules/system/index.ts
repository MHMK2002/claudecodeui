// createSystemModule: used by the server entrypoint to mount protected system update routes.
export { createSystemModule } from './system.module.js';

// loadServerBuildIdentity: used by the server entrypoint to expose immutable health metadata.
export { loadServerBuildIdentity } from './build-identity.service.js';

// Desktop lifecycle helpers: used by the server entrypoint for safe managed-runtime repair.
export {
  getDesktopOwnerProof,
  isDesktopShutdownAuthorized,
  scheduleDesktopRuntimeShutdown,
} from './desktop-runtime.service.js';
