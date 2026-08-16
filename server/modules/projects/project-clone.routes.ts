import express from 'express';

import {
  cancelCloneProjectAttempt,
  startCloneProject,
} from '@/modules/projects/services/project-clone.service.js';
import { AppError, readAuthenticatedUserId } from '@/shared/utils.js';

type ProjectCloneRouteServices = {
  startClone: typeof startCloneProject;
  cancelClone: typeof cancelCloneProjectAttempt;
};

const defaultServices: ProjectCloneRouteServices = {
  startClone: startCloneProject,
  cancelClone: cancelCloneProjectAttempt,
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readOptionalNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readErrorMetadata(error: unknown): {
  code: string;
  message: string;
  action: string;
  field: string;
} {
  if (error instanceof AppError) {
    const details = typeof error.details === 'object' && error.details !== null
      ? error.details as Record<string, unknown>
      : {};
    return {
      code: error.code,
      message: error.message,
      action: readString(details.action) || 'RETRY',
      field: readString(details.field) || 'repositoryUrl',
    };
  }
  return {
    code: 'GIT_CLONE_FAILED',
    message: error instanceof Error ? error.message : 'Failed to clone repository.',
    action: 'RETRY',
    field: 'repositoryUrl',
  };
}

/**
 * Builds the attempt-scoped clone transport mounted by the Projects module.
 * The owning Projects router and route tests inject only the two application
 * service operations; parsing, SSE formatting, and disconnect handling stay here.
 */
export function createProjectCloneRouter(
  services: ProjectCloneRouteServices = defaultServices,
): express.Router {
  const router = express.Router();

  router.post('/clone-progress', async (request, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const body = typeof request.body === 'object' && request.body !== null
      ? request.body as Record<string, unknown>
      : {};
    const attemptId = readString(body.attemptId);
    const requestGeneration = Symbol(attemptId || 'invalid-clone-attempt');
    let userId: number | null = null;
    const sendEvent = (type: string, data: Record<string, unknown>) => {
      if (!response.writableEnded && !response.destroyed) {
        response.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      }
    };

    let cloneOperation: Awaited<ReturnType<ProjectCloneRouteServices['startClone']>> | null = null;
    const closeListener = () => {
      if (attemptId && userId !== null) {
        services.cancelClone(attemptId, userId, requestGeneration);
      }
    };
    response.on('close', closeListener);

    try {
      sendEvent('attempt', { attemptId });
      userId = readAuthenticatedUserId(request);

      cloneOperation = await services.startClone({
        attemptId,
        repositoryUrl: readString(body.repositoryUrl),
        destinationPath: readString(body.destinationPath),
        githubTokenId: readOptionalNumber(body.githubTokenId),
        newGithubToken: readString(body.newGithubToken) || null,
        userId,
        requestGeneration,
      }, {
        onProgress: (progress) => sendEvent('progress', progress),
        onComplete: ({ project, message }) => sendEvent('complete', { project, message }),
      });

      await cloneOperation.waitForCompletion;
    } catch (error) {
      sendEvent('error', { ...readErrorMetadata(error), attemptId });
    } finally {
      response.off('close', closeListener);
      cloneOperation?.release();
      if (!response.writableEnded) response.end();
    }
  });

  router.delete('/clone-attempts/:attemptId', (request, response) => {
    const attemptId = readString(request.params.attemptId);
    const authenticatedUserId = readAuthenticatedUserId(request);
    const cancellationResult = attemptId
      ? services.cancelClone(attemptId, authenticatedUserId)
      : 'not_found';
    if (cancellationResult === 'not_found' || cancellationResult === 'forbidden') {
      response.status(404).json({
        success: false,
        error: { code: 'CLONE_ATTEMPT_NOT_FOUND', message: 'Clone attempt not found.' },
      });
      return;
    }
    if (cancellationResult === 'too_late') {
      response.status(409).json({
        success: false,
        error: {
          code: 'CLONE_CANCELLATION_TOO_LATE',
          message: 'Clone finalization has started and can no longer be cancelled safely.',
        },
      });
      return;
    }
    response.status(202).json({ success: true, attemptId });
  });

  return router;
}
