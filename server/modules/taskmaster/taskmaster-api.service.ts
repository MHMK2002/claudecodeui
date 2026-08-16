import path from 'node:path';

import type crossSpawn from 'cross-spawn';

import type { taskmasterInitializerService } from './taskmaster-initializer.service.js';
import type { createTaskmasterService } from './taskmaster.service.js';
import type { taskmasterWorkflowService } from './taskmaster-workflow.service.js';

type TaskmasterApiServiceDependencies = {
    fileSystem: typeof import('node:fs');
    fileSystemPromises: typeof import('node:fs/promises');
    spawnProcess: typeof crossSpawn;
    resolveProjectPathById(projectId: string): string | null | Promise<string | null>;
    taskmasterStatusService: ReturnType<typeof createTaskmasterService>;
    taskmasterInitializer: typeof taskmasterInitializerService;
    taskmasterWorkflow: typeof taskmasterWorkflowService;
};

type TaskRecord = Record<string, unknown> & {
    id?: string | number;
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    dependencies?: unknown[];
    createdAt?: string;
    created?: string;
    updatedAt?: string;
    updated?: string;
    details?: string;
    testStrategy?: string;
    test_strategy?: string;
    subtasks?: unknown[];
};

type ProcessResult = {
    code: number | null;
    error: Error | null;
    stdout: string;
    stderr: string;
};

type UpdateTaskInput = {
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    details?: string;
    statusOnly: boolean;
};

type WorkflowSelection = {
    provider?: unknown;
    providerProfileId?: unknown;
};

type PublicErrorBody = Record<string, unknown> & {
    error: string;
    message?: string;
};

type PrdTemplate = {
    id: string;
    name: string;
    description: string;
    category: string;
    content: string;
};

const PRD_FILE_NAME_PATTERN = /^[\w\-. ]+\.(txt|md)$/;

function currentDate(): string {
    return new Date().toISOString().split('T')[0] ?? '';
}

function getPrdTemplates(): PrdTemplate[] {
    const date = currentDate();
    return [
        {
            id: 'web-app',
            name: 'Web Application',
            description: 'Template for web application projects with frontend and backend components',
            category: 'web',
            content: `# Product Requirements Document - Web Application

## Overview
**Product Name:** [Your App Name]
**Version:** 1.0
**Date:** ${date}
**Author:** [Your Name]

## Executive Summary
Describe what the application does, who it serves, and why it is needed.

## Product Goals
- [Specific measurable goal]
- [Specific measurable goal]
- [Specific measurable goal]

## User Stories
1. As a user, I want [feature] so I can [benefit].
2. As a user, I want [feature] so I can [benefit].
3. As a user, I want [feature] so I can [benefit].

## Technical Requirements
- Frontend framework and accessibility requirements
- Backend services and API contracts
- Data storage and migration requirements
- Authentication and security requirements
- Automated testing and deployment requirements

## Success Metrics
- User engagement and completion metrics
- Performance and reliability targets
- Error-rate and satisfaction targets

## Constraints & Assumptions
- Budget, schedule, staffing, and technical constraints`,
        },
        {
            id: 'api',
            name: 'REST API',
            description: 'Template for REST API development projects',
            category: 'backend',
            content: `# Product Requirements Document - REST API

## Overview
**API Name:** [Your API Name]
**Version:** v1.0
**Date:** ${date}
**Author:** [Your Name]

## Executive Summary
Describe the API purpose, target clients, and primary use cases.

## Functional Requirements
- Authentication and authorization endpoints
- Resource CRUD endpoints and pagination
- Consistent error envelopes and status codes
- Idempotency and versioning expectations

## Non-functional Requirements
- Response-time and throughput targets
- Availability, observability, and audit requirements
- Input validation, rate limiting, and transport security

## Data & Integrations
- Data model and migration strategy
- External systems, failure modes, and retry policy

## Testing & Delivery
- Unit, integration, contract, load, and security testing
- Documentation, deployment, rollback, and monitoring

## Success Metrics
- Availability and latency targets
- Error-rate and adoption targets`,
        },
        {
            id: 'mobile-app',
            name: 'Mobile Application',
            description: 'Template for mobile app development projects (iOS/Android)',
            category: 'mobile',
            content: `# Product Requirements Document - Mobile Application

## Overview
**App Name:** [Your App Name]
**Platform:** iOS / Android / Cross-platform
**Version:** 1.0
**Date:** ${date}
**Author:** [Your Name]

## Executive Summary
Describe the app purpose, target audience, and value proposition.

## Product Goals
- [Specific engagement goal]
- [Specific capability goal]
- [Specific performance goal]

## User Journeys
- Onboarding and authentication
- Primary task completion
- Offline and synchronization behavior
- Permission and device-capability recovery

## Technical Requirements
- Supported OS versions and devices
- Navigation, state management, and local storage
- API integration, background work, and notifications
- Accessibility, privacy, and secure secret storage

## Testing & Release
- Unit, UI, device, performance, and security tests
- Store review, staged rollout, monitoring, and rollback

## Success Metrics
- Retention, task completion, stability, and store rating`,
        },
        {
            id: 'data-analysis',
            name: 'Data Analysis Project',
            description: 'Template for data analysis and visualization projects',
            category: 'data',
            content: `# Product Requirements Document - Data Analysis Project

## Overview
**Project Name:** [Your Analysis Project]
**Analysis Type:** [Descriptive/Predictive/Prescriptive]
**Date:** ${date}
**Author:** [Your Name]

## Executive Summary
Describe the business question, data sources, and expected decisions.

## Goals & Success Criteria
- [Business question to answer]
- [Prediction or recommendation to produce]
- Statistical, operational, and stakeholder acceptance criteria

## Data Requirements
- Sources, formats, ownership, volume, and update frequency
- Completeness, accuracy, consistency, and retention requirements
- Privacy, access, and lineage constraints

## Methodology
- Exploration, cleaning, and validation
- Statistical analysis or model selection
- Evaluation, interpretation, and reproducibility

## Deliverables
- Reproducible pipeline and tests
- Technical report and stakeholder summary
- Visualizations, limitations, and monitoring plan

## Success Metrics
- Decision impact, reproducibility, and model or analysis quality`,
        },
    ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function apiError(statusCode: number, body: PublicErrorBody): TaskmasterApiError {
    return new TaskmasterApiError(statusCode, body);
}

function extractTasks(value: unknown): { tasks: TaskRecord[]; currentTag: string } {
    if (Array.isArray(value)) {
        return { tasks: value.filter(isRecord) as TaskRecord[], currentTag: 'master' };
    }
    if (!isRecord(value)) return { tasks: [], currentTag: 'master' };
    if (Array.isArray(value.tasks)) {
        return { tasks: value.tasks.filter(isRecord) as TaskRecord[], currentTag: 'master' };
    }

    const preferredTags = ['master', ...Object.keys(value).filter((key) => key !== 'master')];
    for (const tag of preferredTags) {
        const candidate = value[tag];
        if (isRecord(candidate) && Array.isArray(candidate.tasks)) {
            return {
                tasks: candidate.tasks.filter(isRecord) as TaskRecord[],
                currentTag: tag,
            };
        }
    }
    return { tasks: [], currentTag: 'master' };
}

function runProcess(
    spawnProcess: TaskmasterApiServiceDependencies['spawnProcess'],
    command: string,
    args: string[],
    options: Parameters<TaskmasterApiServiceDependencies['spawnProcess']>[2],
): Promise<ProcessResult> {
    return new Promise((resolve) => {
        const child = spawnProcess(command, args, options);
        let stdout = '';
        let stderr = '';
        let settled = false;
        child.stdout?.on('data', (data: Buffer | string) => { stdout += data.toString(); });
        child.stderr?.on('data', (data: Buffer | string) => { stderr += data.toString(); });
        const settle = (code: number | null, error: Error | null = null) => {
            if (settled) return;
            settled = true;
            resolve({ code, error, stdout, stderr });
        };
        child.once('error', (error: Error) => settle(null, error));
        child.once('close', (code: number | null) => settle(code));
        child.stdin?.end();
    });
}

/**
 * Deliberate service failure consumed by TaskMaster routes so filesystem and
 * subprocess errors are translated without moving orchestration into Express.
 */
export class TaskmasterApiError extends Error {
    constructor(
        readonly statusCode: number,
        readonly body: PublicErrorBody,
    ) {
        super(typeof body.message === 'string' ? body.message : body.error);
        this.name = 'TaskmasterApiError';
    }
}

/**
 * Creates the TaskMaster application service consumed by the TaskMaster module.
 * It owns project resolution, filesystem persistence, CLI execution, setup, and
 * workflow orchestration; the router remains an HTTP adapter only.
 */
export function createTaskmasterApiService(dependencies: TaskmasterApiServiceDependencies) {
    const fs = dependencies.fileSystem;
    const fsPromises = dependencies.fileSystemPromises;

    const requireProjectPath = async (projectId: string): Promise<string> => {
        const projectPath = await dependencies.resolveProjectPathById(projectId);
        if (!projectPath) {
            throw apiError(404, {
                error: 'Project not found',
                message: `Project "${projectId}" does not exist`,
            });
        }
        return projectPath;
    };

    const requireWorkflowProjectPath = async (projectId: string): Promise<string> => {
        try {
            return await requireProjectPath(projectId);
        } catch (error) {
            if (error instanceof TaskmasterApiError && error.statusCode === 404) {
                throw Object.assign(new Error('Project not found.'), {
                    code: 'PROJECT_NOT_FOUND',
                    statusCode: 404,
                });
            }
            throw error;
        }
    };

    const requireInitializationProjectPath = async (projectId: string): Promise<string> => {
        try {
            return await requireProjectPath(projectId);
        } catch (error) {
            if (error instanceof TaskmasterApiError && error.statusCode === 404) {
                throw Object.assign(new Error('The selected project is unavailable.'), {
                    code: 'PROJECT_NOT_FOUND',
                    statusCode: 404,
                    recovery: 'RETRY',
                });
            }
            throw error;
        }
    };

    return {
        async getInstallationStatus() {
            const result = await runProcess(
                dependencies.spawnProcess,
                'task-master',
                ['--version'],
                { stdio: ['ignore', 'pipe', 'pipe'] },
            );
            const installation = result.code === 0
                ? {
                    isInstalled: true,
                    installPath: 'PATH',
                    version: result.stdout.trim() || 'unknown',
                    reason: null,
                }
                : {
                    isInstalled: false,
                    installPath: null,
                    version: null,
                    reason: result.error
                        ? `Error checking installation: ${result.error.message}`
                        : 'TaskMaster CLI not found in PATH',
                };
            const mcpServer = await dependencies.taskmasterStatusService.detectMcpServer();
            return {
                success: true,
                installation,
                mcpServer,
                isReady: installation.isInstalled && mcpServer.hasMCPServer,
            };
        },

        detectMcpServer() {
            return dependencies.taskmasterStatusService.detectMcpServer();
        },

        async loadTasks(projectId: string) {
            const projectPath = await requireProjectPath(projectId);
            const tasksFilePath = path.join(projectPath, '.taskmaster', 'tasks', 'tasks.json');
            try {
                await fsPromises.access(tasksFilePath);
            } catch {
                return { projectId, tasks: [], message: 'No tasks.json file found' };
            }

            try {
                const parsed = JSON.parse(await fsPromises.readFile(tasksFilePath, 'utf8')) as unknown;
                const { tasks, currentTag } = extractTasks(parsed);
                const taskWorkflow = await dependencies.taskmasterWorkflow.getTaskWorkflowSummary(projectPath) as
                    Record<string, { implementationSessionId?: unknown }>;
                const timestamp = new Date().toISOString();
                const transformedTasks = tasks.map((task) => {
                    const taskId = String(task.id ?? '');
                    const workflow = taskWorkflow[taskId] ?? null;
                    return {
                        id: task.id,
                        title: task.title || 'Untitled Task',
                        description: task.description || '',
                        status: task.status || 'pending',
                        priority: task.priority || 'medium',
                        dependencies: task.dependencies || [],
                        createdAt: task.createdAt || task.created || timestamp,
                        updatedAt: task.updatedAt || task.updated || timestamp,
                        details: task.details || '',
                        testStrategy: task.testStrategy || task.test_strategy || '',
                        subtasks: task.subtasks || [],
                        workflow,
                        implementationSessionId: workflow?.implementationSessionId || null,
                    };
                });
                const countStatus = (status: string) => transformedTasks.filter((task) => task.status === status).length;
                return {
                    projectId,
                    projectPath,
                    tasks: transformedTasks,
                    currentTag,
                    totalTasks: transformedTasks.length,
                    tasksByStatus: {
                        pending: countStatus('pending'),
                        'in-progress': countStatus('in-progress'),
                        done: countStatus('done'),
                        review: countStatus('review'),
                        deferred: countStatus('deferred'),
                        cancelled: countStatus('cancelled'),
                    },
                    timestamp,
                };
            } catch (error) {
                throw apiError(500, {
                    error: 'Failed to parse tasks file',
                    message: errorMessage(error),
                });
            }
        },

        async listPrdFiles(projectId: string) {
            const projectPath = await requireProjectPath(projectId);
            const docsPath = path.join(projectPath, '.taskmaster', 'docs');
            try {
                await fsPromises.access(docsPath, fs.constants.R_OK);
            } catch {
                return { projectId, prdFiles: [], message: 'No .taskmaster/docs directory found' };
            }
            try {
                const files = await fsPromises.readdir(docsPath);
                const prdFiles = [];
                for (const file of files) {
                    const filePath = path.join(docsPath, file);
                    const stats = await fsPromises.stat(filePath);
                    if (stats.isFile() && (file.endsWith('.txt') || file.endsWith('.md'))) {
                        prdFiles.push({
                            name: file,
                            path: path.relative(projectPath, filePath),
                            size: stats.size,
                            modified: stats.mtime.toISOString(),
                            created: stats.birthtime.toISOString(),
                        });
                    }
                }
                prdFiles.sort((left, right) => Date.parse(right.modified) - Date.parse(left.modified));
                return { projectId, projectPath, prdFiles, timestamp: new Date().toISOString() };
            } catch (error) {
                throw apiError(500, { error: 'Failed to read PRD files', message: errorMessage(error) });
            }
        },

        async savePrd(projectId: string, fileName: string, content: string) {
            if (!PRD_FILE_NAME_PATTERN.test(fileName)) {
                throw apiError(400, {
                    error: 'Invalid filename',
                    message: 'Filename must end with .txt or .md and contain only alphanumeric characters, spaces, dots, and dashes',
                });
            }
            const projectPath = await requireProjectPath(projectId);
            const docsPath = path.join(projectPath, '.taskmaster', 'docs');
            const filePath = path.join(docsPath, fileName);
            try {
                await fsPromises.mkdir(docsPath, { recursive: true });
                await fsPromises.writeFile(filePath, content, 'utf8');
                const stats = await fsPromises.stat(filePath);
                return {
                    projectId,
                    projectPath,
                    fileName,
                    filePath: path.relative(projectPath, filePath),
                    size: stats.size,
                    created: stats.birthtime.toISOString(),
                    modified: stats.mtime.toISOString(),
                    message: 'PRD file saved successfully',
                    timestamp: new Date().toISOString(),
                };
            } catch (error) {
                throw apiError(500, { error: 'Failed to write PRD file', message: errorMessage(error) });
            }
        },

        async readPrd(projectId: string, fileName: string) {
            if (!PRD_FILE_NAME_PATTERN.test(fileName)) {
                throw apiError(400, { error: 'Invalid filename', message: 'A .txt or .md PRD filename is required.' });
            }
            const projectPath = await requireProjectPath(projectId);
            const filePath = path.join(projectPath, '.taskmaster', 'docs', fileName);
            try {
                await fsPromises.access(filePath, fs.constants.R_OK);
            } catch {
                throw apiError(404, {
                    error: 'PRD file not found',
                    message: `File "${fileName}" does not exist`,
                });
            }
            try {
                const [content, stats] = await Promise.all([
                    fsPromises.readFile(filePath, 'utf8'),
                    fsPromises.stat(filePath),
                ]);
                return {
                    projectId,
                    projectPath,
                    fileName,
                    filePath: path.relative(projectPath, filePath),
                    content,
                    size: stats.size,
                    created: stats.birthtime.toISOString(),
                    modified: stats.mtime.toISOString(),
                    timestamp: new Date().toISOString(),
                };
            } catch (error) {
                throw apiError(500, { error: 'Failed to read PRD file', message: errorMessage(error) });
            }
        },

        async analyzeInitialization(projectId: string, repair: boolean) {
            const projectPath = await requireInitializationProjectPath(projectId);
            const plan = await dependencies.taskmasterInitializer.analyze(projectPath, { repair });
            const { projectPath: _privatePath, ...publicPlan } = plan;
            return publicPlan;
        },

        async applyInitialization(
            projectId: string,
            attemptId: string,
            onProgress: (progress: unknown) => void,
        ) {
            const projectPath = await requireInitializationProjectPath(projectId);
            return dependencies.taskmasterInitializer.apply(projectPath, attemptId, { onProgress });
        },

        async cancelInitialization(projectId: string, attemptId: string) {
            const projectPath = await requireInitializationProjectPath(projectId);
            return dependencies.taskmasterInitializer.cancel(projectPath, attemptId);
        },

        async updateTask(projectId: string, taskId: string, input: UpdateTaskInput) {
            const projectPath = await requireProjectPath(projectId);
            const args = input.status && input.statusOnly
                ? ['task-master-ai', 'set-status', `--id=${taskId}`, `--status=${input.status}`]
                : [
                    'task-master-ai',
                    'update-task',
                    `--id=${taskId}`,
                    `--prompt=${[
                        input.title ? `title: "${input.title}"` : null,
                        input.description ? `description: "${input.description}"` : null,
                        input.priority ? `priority: "${input.priority}"` : null,
                        input.details ? `details: "${input.details}"` : null,
                    ].filter(Boolean).join(', ')}`,
                ];
            const result = await runProcess(
                dependencies.spawnProcess,
                'npx',
                args,
                { cwd: projectPath, stdio: ['pipe', 'pipe', 'pipe'] },
            );
            if (result.code !== 0) {
                throw apiError(500, {
                    error: input.status && input.statusOnly
                        ? 'Failed to update task status'
                        : 'Failed to update task',
                    message: result.error?.message || result.stderr || result.stdout,
                    code: result.code,
                });
            }
            return {
                projectId,
                projectPath,
                taskId,
                message: input.status && input.statusOnly
                    ? 'Task status updated successfully'
                    : 'Task updated successfully',
                output: result.stdout,
                timestamp: new Date().toISOString(),
            };
        },

        listPrdTemplates() {
            return { templates: getPrdTemplates(), timestamp: new Date().toISOString() };
        },

        async applyPrdTemplate(
            projectId: string,
            templateId: string,
            fileName: string,
            customizations: Record<string, string>,
        ) {
            if (!PRD_FILE_NAME_PATTERN.test(fileName)) {
                throw apiError(400, { error: 'Invalid filename', message: 'A .txt or .md PRD filename is required.' });
            }
            const projectPath = await requireProjectPath(projectId);
            const template = getPrdTemplates().find((candidate) => candidate.id === templateId);
            if (!template) {
                throw apiError(404, {
                    error: 'Template not found',
                    message: `Template "${templateId}" does not exist`,
                });
            }
            let content = template.content;
            for (const [key, value] of Object.entries(customizations)) {
                const placeholder = `[${key}]`;
                const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                content = content.replace(new RegExp(escapedPlaceholder, 'g'), value);
            }
            const docsDirectory = path.join(projectPath, '.taskmaster', 'docs');
            const filePath = path.join(docsDirectory, fileName);
            try {
                await fsPromises.mkdir(docsDirectory, { recursive: true });
                await fsPromises.writeFile(filePath, content, 'utf8');
            } catch (error) {
                throw apiError(500, { error: 'Failed to write PRD template', message: errorMessage(error) });
            }
            return {
                projectId,
                projectPath,
                templateId,
                templateName: template.name,
                fileName,
                filePath,
                message: 'PRD template applied successfully',
                timestamp: new Date().toISOString(),
            };
        },

        async createIntake(projectId: string, userId: number, brief: unknown, selection: WorkflowSelection) {
            const projectPath = await requireWorkflowProjectPath(projectId);
            return dependencies.taskmasterWorkflow.createIntake({
                projectPath,
                projectId,
                userId,
                brief,
                provider: selection.provider,
                providerProfileId: selection.providerProfileId,
            });
        },

        async listIntakes(projectId: string, userId: number) {
            const projectPath = await requireWorkflowProjectPath(projectId);
            return dependencies.taskmasterWorkflow.listIntakes({ projectPath, userId });
        },

        async bindIntake(projectId: string, intakeId: string, userId: number, sessionId: unknown) {
            const projectPath = await requireWorkflowProjectPath(projectId);
            return dependencies.taskmasterWorkflow.bindIntakeSession({ projectPath, intakeId, userId, sessionId });
        },

        async approveIntake(
            projectId: string,
            intakeId: string,
            userId: number,
            input: { approved: unknown; proposalHash: unknown; idempotencyKey: unknown },
        ) {
            const projectPath = await requireWorkflowProjectPath(projectId);
            return dependencies.taskmasterWorkflow.approveIntake({ projectPath, intakeId, userId, ...input });
        },

        async beginLaunch(
            projectId: string,
            taskId: string,
            userId: number,
            input: WorkflowSelection & { idempotencyKey: unknown },
        ) {
            const projectPath = await requireWorkflowProjectPath(projectId);
            return dependencies.taskmasterWorkflow.beginLaunch({
                projectPath,
                taskId,
                userId,
                provider: input.provider,
                providerProfileId: input.providerProfileId,
                idempotencyKey: input.idempotencyKey,
            });
        },

        async bindLaunch(projectId: string, attemptId: string, userId: number, sessionId: unknown) {
            const projectPath = await requireWorkflowProjectPath(projectId);
            return dependencies.taskmasterWorkflow.bindLaunchSession({ projectPath, attemptId, userId, sessionId });
        },

        async getLaunch(projectId: string, attemptId: string, userId: number) {
            const projectPath = await requireWorkflowProjectPath(projectId);
            return dependencies.taskmasterWorkflow.getLaunch({ projectPath, attemptId, userId });
        },
    };
}
