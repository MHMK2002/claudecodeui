#!/usr/bin/env node
// Load environment variables before other imports execute.
import './load-env.js';
import fs, { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';

import {
    AppError,
    findApplicationRoot,
    getModuleDirectory,
    IS_PLATFORM,
    PRODUCT_CONFIG,
    RUNTIME_MODE,
    terminalTextStyles,
    validateServerRuntimeHost,
} from '@/shared/utils.js';
import {
    closeSessionsWatcher,
    initializeSessionsWatcher,
    providerRuntimeService,
    providerTextCompletionService,
} from '@/modules/providers/index.js';
import { createWebSocketServer } from '@/modules/websocket/index.js';
import { resolveActiveProjectDirectory } from '@/modules/projects/index.js';

import { getConnectableHost } from '../shared/networkHosts.js';

import { createGitModule } from './modules/git/index.js';
import {
    authenticateToken,
    authenticateWebSocket,
    authRoutes,
    validateApiKey,
} from './modules/auth/index.js';
import { taskmasterRoutes } from './modules/taskmaster/index.js';
import {
    scheduledRunsRoutes,
    startScheduler,
    stopScheduler,
} from './modules/scheduled-runs/index.js';
import { commandsRoutes } from './modules/commands/index.js';
import { settingsRoutes } from './modules/settings/index.js';
import {
    createSystemModule,
    getDesktopOwnerProof,
    isDesktopShutdownAuthorized,
    loadServerBuildIdentity,
    scheduleDesktopRuntimeShutdown,
} from './modules/system/index.js';
import { createAgentModule } from './modules/agent/index.js';
import projectModuleRoutes from './modules/projects/projects.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';
import { userRoutes } from './modules/user/index.js';
import {
    getPluginPort,
    pluginsRoutes,
    startEnabledPluginServers,
    stopAllPlugins,
} from './modules/plugins/index.js';
import providerRoutes from './modules/providers/provider.routes.js';
import { voiceRoutes } from './modules/voice/index.js';
import browserUseRoutes from './modules/browser-use/browser-use.routes.js';
import { assetsRoutes } from './modules/assets/index.js';
import { fileTreeRoutes } from './modules/file-tree/index.js';
import { worktreesRoutes } from './modules/worktrees/index.js';
import browserUseMcpRoutes from './modules/browser-use/browser-use-mcp.routes.js';
import { browserUseService } from './modules/browser-use/browser-use.service.js';
import { initializeDatabase } from './modules/database/index.js';
import { configureWebPush } from './modules/notifications/index.js';

const __dirname = getModuleDirectory(import.meta.url);
// The server source runs from /server, while the compiled output runs from /dist-server/server.
// Resolving the app root once keeps every repo-level lookup below aligned across both layouts.
const APP_ROOT = findApplicationRoot(__dirname);
const installMode = fs.existsSync(path.join(APP_ROOT, '.git')) ? 'git' : 'npm';
const runtimeLayout = path.relative(APP_ROOT, __dirname).split(path.sep)[0] === 'dist-server'
    ? 'compiled'
    : 'source';
// Captured once at process startup so a replaced on-disk bundle cannot make an
// old process report the new identity. Missing or malformed identity is a
// startup failure, never a successful "unidentified" health response.
const RUNNING_BUILD_IDENTITY = loadServerBuildIdentity({
    appRoot: APP_ROOT,
    runtimeLayout,
});
const systemRoutes = createSystemModule({
    appRoot: APP_ROOT,
    installMode,
    isPlatform: IS_PLATFORM,
});
console.log('SERVER_PORT from env:', process.env.SERVER_PORT);

const app = express();
const server = http.createServer(app);
const queryClaude = providerRuntimeService.getRunner('claude');
const queryCursor = providerRuntimeService.getRunner('cursor');
const queryCodex = providerRuntimeService.getRunner('codex');
const queryOpenCode = providerRuntimeService.getRunner('opencode');
const gitRoutes = createGitModule({
    textCompletion: providerTextCompletionService,
});
const agentRoutes = createAgentModule({
    queryClaude,
    queryCursor,
    queryCodex,
    queryOpenCode,
});

// Single WebSocket server that handles chat, shell, and plugin proxy paths.
const wss = createWebSocketServer(server, {
    verifyClient: {
        runtimeMode: RUNTIME_MODE,
        allowedDesktopOrigin: process.env.CLOUDCLI_DESKTOP_ALLOWED_ORIGIN,
        authenticateWebSocket,
    },
    chat: {
        runtime: providerRuntimeService,
    },
    shell: {
        resolveProjectPath: resolveActiveProjectDirectory,
    },
    commandTerminal: {},
    getPluginPort,
});

// Make WebSocket server available to routes
app.locals.wss = wss;

app.use(cors({ exposedHeaders: ['X-Refreshed-Token', 'X-Auth-Error', 'X-CloudCLI-Runtime-Mode'] }));
app.use(express.json({
    limit: '50mb',
    type: (req) => {
        // Skip multipart/form-data requests (for file uploads like images)
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            return false;
        }
        return contentType.includes('json');
    }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Public health check endpoint (no authentication required)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        installMode,
        version: RUNNING_BUILD_IDENTITY.version,
        buildId: RUNNING_BUILD_IDENTITY.buildId,
        productName: PRODUCT_CONFIG.productName,
        features: PRODUCT_CONFIG.features,
        runtimeMode: RUNTIME_MODE,
        pid: process.pid,
        desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE || null,
        desktopOwnerProof: getDesktopOwnerProof(process.env.CLOUDCLI_DESKTOP_OWNER_NONCE),
        desktopProcessStartedAt: process.env.CLOUDCLI_DESKTOP_PROCESS_STARTED_AT || null,
    });
});

// An app-managed runtime shuts down itself after proving ownership. Electron
// never sends a signal to a PID inferred only from a mutable marker file.
app.post('/desktop/shutdown', (req, res) => {
    const providedOwnerNonce = req.headers['x-cloudcli-desktop-owner-nonce'];
    const authorized = isDesktopShutdownAuthorized({
        remoteAddress: req.socket.remoteAddress,
        providedOwnerNonce: typeof providedOwnerNonce === 'string' ? providedOwnerNonce : undefined,
        expectedOwnerNonce: process.env.CLOUDCLI_DESKTOP_OWNER_NONCE,
    });
    if (!authorized) {
        return res.status(404).json({ success: false });
    }
    res.status(202).json({ success: true });
    scheduleDesktopRuntimeShutdown(() => void shutdownRuntimeServices());
});

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// File Tree API Routes (protected)
app.use('/api/file-tree', authenticateToken, fileTreeRoutes);

// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectModuleRoutes);

// Chat attachment upload/serving (global ~/.cloudcli/assets store, protected)
app.use('/api/assets', authenticateToken, assetsRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// Git worktree management (protected)
app.use('/api/worktrees', authenticateToken, worktreesRoutes);

// TaskMaster API Routes (protected)
app.use('/api/taskmaster', authenticateToken, taskmasterRoutes);

// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);

// Settings API Routes (protected)
app.use('/api/settings', authenticateToken, settingsRoutes);

app.use('/api/system', authenticateToken, systemRoutes);

app.use('/api/notifications', authenticateToken, notificationRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Plugins API Routes (protected)
app.use('/api/plugins', authenticateToken, pluginsRoutes);

// Browser MCP bridge API (local token protected)
app.use('/api/browser-use-mcp', browserUseMcpRoutes);

// Browser API Routes (protected)
app.use('/api/browser-use', authenticateToken, browserUseRoutes);

// Unified provider MCP routes (protected)
app.use('/api/providers', authenticateToken, providerRoutes);

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

// Scheduled runs API routes (uses API key authentication; cron + scheduler)
app.use('/api/scheduled-runs', authenticateToken, scheduledRunsRoutes);

app.use('/api/voice', authenticateToken, voiceRoutes);

// Serve public files (like api-docs.html)
app.use(express.static(path.join(APP_ROOT, 'public')));

// Static files served after API routes
// Add cache control: HTML files should not be cached, but assets can be cached
app.use(express.static(path.join(APP_ROOT, 'dist'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            // Prevent HTML caching to avoid service worker issues after builds
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
            // Cache static assets for 1 year (they have hashed names)
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// API Routes (protected)
// /api/config endpoint removed - no longer needed
// Frontend now uses window.location for WebSocket URLs

// Chat uploads live under /api/assets (server/modules/assets), which stores
// images and general files in the global ~/.cloudcli/assets folder.

// Serve React app for all other routes (excluding static files)
app.get('*', (req, res) => {
    // Skip requests for static assets (files with extensions)
    if (path.extname(req.path)) {
        return res.status(404).send('Not found');
    }

    // Only serve index.html for HTML routes, not for static assets
    // Static assets should already be handled by express.static middleware above
    const indexPath = path.join(APP_ROOT, 'dist', 'index.html');

    // Check if dist/index.html exists (production build available)
    if (fs.existsSync(indexPath)) {
        // Set no-cache headers for HTML to prevent service worker issues
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(indexPath);
    } else {
        // In development, redirect to Vite dev server only if dist doesn't exist
        const redirectHost = getConnectableHost(req.hostname);
        res.redirect(`${req.protocol}://${redirectHost}:${VITE_PORT}`);
    }
});

// global error middleware must be last
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  console.error(err);

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

const SERVER_PORT = Number.parseInt(process.env.SERVER_PORT || '3001', 10);
const HOST = validateServerRuntimeHost(process.env.HOST || '0.0.0.0');
const DISPLAY_HOST = getConnectableHost(HOST);
const VITE_PORT = process.env.VITE_PORT || 5173;
const LOCAL_SERVER_MARKER_PATH = path.join(os.homedir(), '.cloudcli', 'local-server.json');

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return undefined;
    }
    return String(error.code);
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function writeLocalServerMarker() {
    if (process.env.CLOUDCLI_DISABLE_LOCAL_SERVER_MARKER === '1') return;
    const marker = {
        pid: process.pid,
        host: HOST,
        port: Number.parseInt(String(SERVER_PORT), 10),
        url: `http://${DISPLAY_HOST}:${SERVER_PORT}`,
        installMode,
        runtimeMode: RUNTIME_MODE,
        appRoot: APP_ROOT,
        version: RUNNING_BUILD_IDENTITY.version,
        buildId: RUNNING_BUILD_IDENTITY.buildId,
        managedBy: process.env.CLOUDCLI_DESKTOP_OWNER_NONCE ? 'cloudcli-desktop' : null,
        desktopLaunchNonce: process.env.CLOUDCLI_DESKTOP_LAUNCH_NONCE || null,
        desktopOwnerNonce: process.env.CLOUDCLI_DESKTOP_OWNER_NONCE || null,
        desktopProcessStartedAt: process.env.CLOUDCLI_DESKTOP_PROCESS_STARTED_AT || null,
        updatedAt: new Date().toISOString(),
    };

    await fsPromises.mkdir(path.dirname(LOCAL_SERVER_MARKER_PATH), { recursive: true });
    const temporaryPath = `${LOCAL_SERVER_MARKER_PATH}.${process.pid}.tmp`;
    await fsPromises.writeFile(temporaryPath, JSON.stringify(marker, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
    });
    await fsPromises.rename(temporaryPath, LOCAL_SERVER_MARKER_PATH);
}

async function removeLocalServerMarker() {
    if (process.env.CLOUDCLI_DISABLE_LOCAL_SERVER_MARKER === '1') return;
    try {
        const raw = await fsPromises.readFile(LOCAL_SERVER_MARKER_PATH, 'utf8');
        const marker = JSON.parse(raw);
        if (marker.pid && marker.pid !== process.pid) return;
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') return;
    }

    try {
        await fsPromises.unlink(LOCAL_SERVER_MARKER_PATH);
    } catch (error) {
        if (getErrorCode(error) !== 'ENOENT') {
            console.warn('[WARN] Could not remove local server marker:', getErrorMessage(error));
        }
    }
}

let shutdownPromise: Promise<void> | null = null;

async function shutdownRuntimeServices(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
        const forceExitTimer = setTimeout(() => process.exit(1), 5_000);
        forceExitTimer.unref();
        server.close();
        try {
            await closeSessionsWatcher();
        } catch (err) {
            console.error('[Sessions] Error during shutdown:', getErrorMessage(err));
        }
        try {
            await stopScheduler();
        } catch (err) {
            console.error('[Scheduler] Error during shutdown:', getErrorMessage(err));
        }
        try {
            await browserUseService.stopAllSessions();
        } catch (err) {
            console.error('[Browser] Error stopping sessions during shutdown:', getErrorMessage(err));
        }
        try {
            await stopAllPlugins();
        } catch (err) {
            console.error('[Plugins] Error stopping plugins during shutdown:', getErrorMessage(err));
        }
        try {
            await removeLocalServerMarker();
        } catch (err) {
            console.error('[Local Server] Error removing server marker during shutdown:', getErrorMessage(err));
        }
        clearTimeout(forceExitTimer);
        process.exit(0);
    })();
    return shutdownPromise;
}

// Initialize database and start server
async function startServer() {
    try {
        // Initialize authentication database
        await initializeDatabase();

        // Configure Web Push (VAPID keys)
        configureWebPush();

        // Check if running in production mode (dist folder exists)
        const distIndexPath = path.join(APP_ROOT, 'dist', 'index.html');
        const isProduction = fs.existsSync(distIndexPath);

        // Log Claude implementation mode
        console.log(`${terminalTextStyles.info('[INFO]')} Using Claude Agents SDK for Claude integration`);
        console.log('');

        if (isProduction) {
            console.log(`${terminalTextStyles.info('[INFO]')} To run in production mode, go to http://${DISPLAY_HOST}:${SERVER_PORT}`);
        }

        console.log(`${terminalTextStyles.info('[INFO]')} To run in development mode with hot-module replacement, go to http://${DISPLAY_HOST}:${VITE_PORT}`);
   
        server.listen(SERVER_PORT, HOST, async () => {
            const appInstallPath = APP_ROOT;
            await writeLocalServerMarker().catch((error) => {
                console.warn('[WARN] Could not write local server marker:', error.message);
            });

            console.log('');
            console.log(terminalTextStyles.dim('═'.repeat(63)));
            console.log(`  ${terminalTextStyles.bright('CloudCLI Server - Ready')}`);
            console.log(terminalTextStyles.dim('═'.repeat(63)));
            console.log('');
            console.log(`${terminalTextStyles.info('[INFO]')} Server URL:  ${terminalTextStyles.bright('http://' + DISPLAY_HOST + ':' + SERVER_PORT)}`);
            console.log(`${terminalTextStyles.info('[INFO]')} Installed at: ${terminalTextStyles.dim(appInstallPath)}`);
            console.log(`${terminalTextStyles.tip('[TIP]')}  Run "cloudcli status" for full configuration details`);
            console.log('');

            // Start watching the projects folder for changes
            await initializeSessionsWatcher();

            // Start the local scheduled-runs loop. Startup repairs interrupted
            // runs and marks downtime due times Missed without replay.
            startScheduler().catch(err => {
                console.error('[Scheduler] Failed to start:', getErrorMessage(err));
            });

            // Start server-side plugin processes for enabled plugins
            startEnabledPluginServers().catch(err => {
                console.error('[Plugins] Error during startup:', err.message);
            });
        });

        process.on('SIGTERM', () => void shutdownRuntimeServices());
        process.on('SIGINT', () => void shutdownRuntimeServices());
    } catch (error) {
        console.error('[ERROR] Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
