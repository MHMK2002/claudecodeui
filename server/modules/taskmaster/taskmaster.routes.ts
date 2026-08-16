import express, { type Request, type Response } from 'express';

import { readAuthenticatedUserId } from '@/shared/utils.js';

import {
    TaskmasterApiError,
    type createTaskmasterApiService,
} from './taskmaster-api.service.js';

type TaskmasterRouterDependencies = {
    taskmasterService: ReturnType<typeof createTaskmasterApiService>;
};

type BroadcastClient = {
    readyState: number;
    send(message: string): void;
};

type BroadcastServer = {
    clients: Iterable<BroadcastClient>;
};

type DeliberateError = Error & {
    code: string;
    statusCode: number;
    recovery?: string;
};

const PRD_FILE_NAME_PATTERN = /^[\w\-. ]+\.(txt|md)$/;

function recordBody(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function isPrdFileName(value: string): boolean {
    return PRD_FILE_NAME_PATTERN.test(value);
}

function isDeliberateError(error: unknown): error is DeliberateError {
    return error instanceof Error
        && typeof (error as Partial<DeliberateError>).code === 'string'
        && Number.isInteger((error as Partial<DeliberateError>).statusCode);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function readBroadcastServer(req: Request): BroadcastServer | null {
    const value = req.app.locals.wss as unknown;
    if (!value || typeof value !== 'object' || !('clients' in value)) return null;
    const clients = (value as { clients?: unknown }).clients;
    return clients && typeof clients === 'object' && Symbol.iterator in clients
        ? value as BroadcastServer
        : null;
}

function broadcastTaskmasterUpdate(
    req: Request,
    type: 'taskmaster-project-updated' | 'taskmaster-tasks-updated',
    projectId: string,
    payload?: Record<string, unknown>,
): void {
    const server = readBroadcastServer(req);
    if (!server) return;
    const message = JSON.stringify({
        type,
        projectId,
        ...payload,
        timestamp: new Date().toISOString(),
    });
    for (const client of server.clients) {
        if (client.readyState === 1) client.send(message);
    }
}

function sendApiError(res: Response, error: unknown, fallback: string): Response {
    if (error instanceof TaskmasterApiError) {
        return res.status(error.statusCode).json(error.body);
    }
    console.error(`TaskMaster ${fallback}:`, error);
    return res.status(500).json({ error: fallback, message: errorMessage(error) });
}

function sendWorkflowError(res: Response, error: unknown): Response {
    if (!isDeliberateError(error)) {
        console.error('TaskMaster workflow request failed:', error);
        return res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: 'Internal server error',
        });
    }
    return res.status(error.statusCode).json({
        success: false,
        error: error.code,
        message: error.message,
    });
}

function readInitializerFailure(error: unknown): {
    statusCode: number;
    body: {
        success: false;
        error: string;
        message: string;
        recovery: 'RETRY' | 'REPAIR';
    };
} {
    if (!isDeliberateError(error)) {
        console.error('TaskMaster initializer failed:', error);
        return {
            statusCode: 500,
            body: {
                success: false,
                error: 'INTERNAL_ERROR',
                message: 'Task setup failed unexpectedly.',
                recovery: 'REPAIR',
            },
        };
    }
    return {
        statusCode: error.statusCode,
        body: {
            success: false,
            error: error.code,
            message: error.message,
            recovery: error.recovery === 'RETRY' ? 'RETRY' : 'REPAIR',
        },
    };
}

/** Creates the authenticated TaskMaster HTTP adapter for the TaskMaster module. */
export function createTaskmasterRouter(dependencies: TaskmasterRouterDependencies): express.Router {
    const service = dependencies.taskmasterService;
    const router = express.Router();

    router.get('/installation-status', async (_req, res) => {
        try {
            return res.json(await service.getInstallationStatus());
        } catch (error) {
            console.error('Error checking TaskMaster installation:', error);
            const message = errorMessage(error);
            return res.status(500).json({
                success: false,
                error: 'Failed to check TaskMaster installation status',
                installation: { isInstalled: false, reason: `Server error: ${message}` },
                mcpServer: { hasMCPServer: false, reason: `Server error: ${message}` },
                isReady: false,
            });
        }
    });

    router.get('/mcp-status', async (_req, res) => {
        try {
            return res.json(await service.detectMcpServer());
        } catch (error) {
            return sendApiError(res, error, 'Failed to detect TaskMaster MCP server');
        }
    });

    router.get('/tasks/:projectId', async (req, res) => {
        try {
            return res.json(await service.loadTasks(req.params.projectId));
        } catch (error) {
            return sendApiError(res, error, 'Failed to load TaskMaster tasks');
        }
    });

    router.get('/prd/:projectId', async (req, res) => {
        try {
            return res.json(await service.listPrdFiles(req.params.projectId));
        } catch (error) {
            return sendApiError(res, error, 'Failed to list PRD files');
        }
    });

    router.post('/prd/:projectId', async (req, res) => {
        const body = recordBody(req.body);
        const fileName = optionalString(body.fileName);
        const content = optionalString(body.content);
        if (!fileName || !content) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'fileName and content are required',
            });
        }
        if (!isPrdFileName(fileName)) {
            return res.status(400).json({
                error: 'Invalid filename',
                message: 'Filename must end with .txt or .md and contain only alphanumeric characters, spaces, dots, and dashes',
            });
        }
        try {
            return res.json(await service.savePrd(req.params.projectId, fileName, content));
        } catch (error) {
            return sendApiError(res, error, 'Failed to create/update PRD file');
        }
    });

    router.get('/prd/:projectId/:fileName', async (req, res) => {
        if (!isPrdFileName(req.params.fileName)) {
            return res.status(400).json({
                error: 'Invalid filename',
                message: 'A .txt or .md PRD filename is required.',
            });
        }
        try {
            return res.json(await service.readPrd(req.params.projectId, req.params.fileName));
        } catch (error) {
            return sendApiError(res, error, 'Failed to read PRD file');
        }
    });

    router.post('/init/:projectId/analyze', async (req, res) => {
        try {
            const plan = await service.analyzeInitialization(
                req.params.projectId,
                recordBody(req.body).repair === true,
            );
            return res.json({ success: true, data: { plan } });
        } catch (error) {
            const failure = readInitializerFailure(error);
            return res.status(failure.statusCode).json(failure.body);
        }
    });

    router.post('/init/:projectId/attempts/:attemptId/apply', async (req, res) => {
        res.status(200);
        res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        const writeEvent = (event: Record<string, unknown>) => {
            if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
        };
        try {
            const result = await service.applyInitialization(
                req.params.projectId,
                req.params.attemptId,
                (progress) => writeEvent({ type: 'progress', progress }),
            );
            broadcastTaskmasterUpdate(req, 'taskmaster-project-updated', req.params.projectId, {
                taskMasterData: { hasTaskmaster: true, status: 'initialized' },
            });
            writeEvent({
                type: 'result',
                success: true,
                data: {
                    after: result.after,
                    added: result.added,
                    replaced: result.replaced,
                    merged: result.merged,
                    rollbackPerformed: result.rollbackPerformed,
                },
            });
        } catch (error) {
            const failure = readInitializerFailure(error);
            writeEvent({ type: 'result', ...failure.body });
        } finally {
            if (!res.writableEnded) res.end();
        }
    });

    router.delete('/init/:projectId/attempts/:attemptId', async (req, res) => {
        try {
            const result = await service.cancelInitialization(req.params.projectId, req.params.attemptId);
            return res.status(result.cancelled ? 202 : 404).json({ success: result.cancelled });
        } catch (error) {
            const failure = readInitializerFailure(error);
            return res.status(failure.statusCode).json(failure.body);
        }
    });

    router.post('/add-task/:projectId', (_req, res) => res.status(409).json({
        success: false,
        error: 'APPROVAL_REQUIRED',
        message: 'Create tasks through Task intake and explicitly approve the clarified proposal.',
    }));

    router.put('/update-task/:projectId/:taskId', async (req, res) => {
        const body = recordBody(req.body);
        try {
            const result = await service.updateTask(req.params.projectId, req.params.taskId, {
                title: optionalString(body.title),
                description: optionalString(body.description),
                status: optionalString(body.status),
                priority: optionalString(body.priority),
                details: optionalString(body.details),
                statusOnly: typeof body.status === 'string' && Object.keys(body).length === 1,
            });
            broadcastTaskmasterUpdate(req, 'taskmaster-tasks-updated', req.params.projectId);
            return res.json(result);
        } catch (error) {
            return sendApiError(res, error, 'Failed to update task');
        }
    });

    router.post('/parse-prd/:projectId', (_req, res) => res.status(409).json({
        success: false,
        error: 'APPROVAL_REQUIRED',
        message: 'Create tasks through Task intake and explicitly approve each clarified proposal.',
    }));

    router.get('/prd-templates', (_req, res) => res.json(service.listPrdTemplates()));

    router.post('/apply-template/:projectId', async (req, res) => {
        const body = recordBody(req.body);
        const templateId = optionalString(body.templateId);
        if (!templateId) {
            return res.status(400).json({
                error: 'Missing required parameter',
                message: 'templateId is required',
            });
        }
        const fileName = optionalString(body.fileName) || 'prd.txt';
        if (!isPrdFileName(fileName)) {
            return res.status(400).json({
                error: 'Invalid filename',
                message: 'A .txt or .md PRD filename is required.',
            });
        }
        const customizations = recordBody(body.customizations);
        if (Object.values(customizations).some((value) => typeof value !== 'string')) {
            return res.status(400).json({
                error: 'Invalid customizations',
                message: 'Template customization values must be strings.',
            });
        }
        try {
            return res.json(await service.applyPrdTemplate(
                req.params.projectId,
                templateId,
                fileName,
                customizations as Record<string, string>,
            ));
        } catch (error) {
            return sendApiError(res, error, 'Failed to apply PRD template');
        }
    });

    router.post('/workflow/:projectId/intakes', async (req, res) => {
        try {
            const body = recordBody(req.body);
            const result = await service.createIntake(
                req.params.projectId,
                readAuthenticatedUserId(req),
                body.brief,
                { provider: body.provider, providerProfileId: body.providerProfileId },
            );
            return res.status(201).json({ success: true, data: result });
        } catch (error) {
            return sendWorkflowError(res, error);
        }
    });

    router.get('/workflow/:projectId/intakes', async (req, res) => {
        try {
            const intakes = await service.listIntakes(req.params.projectId, readAuthenticatedUserId(req));
            return res.json({ success: true, data: { intakes } });
        } catch (error) {
            return sendWorkflowError(res, error);
        }
    });

    router.post('/workflow/:projectId/intakes/:intakeId/bind', async (req, res) => {
        try {
            const intake = await service.bindIntake(
                req.params.projectId,
                req.params.intakeId,
                readAuthenticatedUserId(req),
                recordBody(req.body).sessionId,
            );
            return res.json({ success: true, data: { intake } });
        } catch (error) {
            return sendWorkflowError(res, error);
        }
    });

    router.post('/workflow/:projectId/intakes/:intakeId/approve', async (req, res) => {
        try {
            const body = recordBody(req.body);
            const result = await service.approveIntake(
                req.params.projectId,
                req.params.intakeId,
                readAuthenticatedUserId(req),
                {
                    approved: body.approved,
                    proposalHash: body.proposalHash,
                    idempotencyKey: body.idempotencyKey,
                },
            );
            broadcastTaskmasterUpdate(req, 'taskmaster-tasks-updated', req.params.projectId);
            return res.json({ success: true, data: result });
        } catch (error) {
            return sendWorkflowError(res, error);
        }
    });

    router.post('/workflow/:projectId/tasks/:taskId/launch', async (req, res) => {
        try {
            const body = recordBody(req.body);
            const attempt = await service.beginLaunch(
                req.params.projectId,
                req.params.taskId,
                readAuthenticatedUserId(req),
                {
                    provider: body.provider,
                    providerProfileId: body.providerProfileId,
                    idempotencyKey: body.idempotencyKey,
                },
            );
            return res.status(201).json({ success: true, data: { attempt } });
        } catch (error) {
            return sendWorkflowError(res, error);
        }
    });

    router.post('/workflow/:projectId/launches/:attemptId/bind', async (req, res) => {
        try {
            const attempt = await service.bindLaunch(
                req.params.projectId,
                req.params.attemptId,
                readAuthenticatedUserId(req),
                recordBody(req.body).sessionId,
            );
            return res.json({ success: true, data: { attempt } });
        } catch (error) {
            return sendWorkflowError(res, error);
        }
    });

    router.get('/workflow/:projectId/launches/:attemptId', async (req, res) => {
        try {
            const attempt = await service.getLaunch(
                req.params.projectId,
                req.params.attemptId,
                readAuthenticatedUserId(req),
            );
            return res.json({ success: true, data: { attempt } });
        } catch (error) {
            return sendWorkflowError(res, error);
        }
    });

    return router;
}
