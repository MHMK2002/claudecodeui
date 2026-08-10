import fsp from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import {
  resolveSessionRewindBoundary,
  SessionRewindTargetError,
  type SessionRewindBoundary,
} from '@/modules/providers/services/session-rewind-target.js';
import { broadcastSessionRewound, chatRunRegistry } from '@/modules/websocket/index.js';
import type { LLMProvider, ProviderProfileRuntime } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

// The provider runtimes now live beside their provider implementations; this
// service is their typed orchestration boundary.
import { forkClaudeSessionAt, rewindClaudeFiles } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { forkCodexThreadAt } from '@/modules/providers/list/codex/codex-runtime.provider.js';

export type SessionRewindMode = 'conversation' | 'code' | 'both';

type ProviderFork = {
  sessionId: string;
  jsonlPath: string;
};

type RewindContext = {
  appSessionId: string;
  provider: 'claude' | 'codex';
  providerSessionId: string;
  providerProfile: ProviderProfileRuntime | null;
  projectPath: string;
  jsonlPath: string;
  title: string;
  boundary: SessionRewindBoundary;
};

const rewindsInFlight = new Set<string>();

const assertMode: (mode: string) => asserts mode is SessionRewindMode = (mode) => {
  if (mode !== 'conversation' && mode !== 'code' && mode !== 'both') {
    throw new AppError('mode must be conversation, code, or both.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }
};

const toTargetAppError = (error: SessionRewindTargetError): AppError =>
  new AppError(error.message, {
    code: error.code,
    statusCode: error.code === 'REWIND_TARGET_NOT_FOUND' ? 404 : 409,
  });

const bestEffortRemoveFork = async (fork: ProviderFork | null): Promise<void> => {
  if (!fork?.jsonlPath) return;
  try {
    await fsp.unlink(fork.jsonlPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[SessionRewind] Failed to remove an unowned provider fork.', error);
    }
  }
};

const resolveContext = async (
  appSessionId: string,
  messageId: string,
  providerProfile: ProviderProfileRuntime | null,
): Promise<RewindContext> => {
  const session = sessionsDb.getSessionById(appSessionId);
  if (!session) {
    throw new AppError(`Session "${appSessionId}" was not found.`, {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }
  if (session.isArchived) {
    throw new AppError(`Session "${appSessionId}" is archived and cannot be rewound.`, {
      code: 'SESSION_ARCHIVED',
      statusCode: 409,
    });
  }
  if (chatRunRegistry.isProcessing(appSessionId)) {
    throw new AppError('Stop the active response before rewinding this conversation.', {
      code: 'SESSION_RUN_IN_PROGRESS',
      statusCode: 409,
    });
  }

  const provider = session.provider as LLMProvider;
  if (provider !== 'claude' && provider !== 'codex') {
    throw new AppError(`Provider "${provider}" does not support message rewind.`, {
      code: 'PROVIDER_REWIND_UNSUPPORTED',
      statusCode: 400,
    });
  }
  if (!session.provider_session_id || !session.jsonl_path) {
    throw new AppError('This session has no provider transcript to rewind.', {
      code: 'SESSION_HAS_NO_TRANSCRIPT',
      statusCode: 409,
    });
  }

  let boundary: SessionRewindBoundary;
  try {
    boundary = await resolveSessionRewindBoundary(session.jsonl_path, provider, messageId);
  } catch (error) {
    if (error instanceof SessionRewindTargetError) throw toTargetAppError(error);
    throw error;
  }

  return {
    appSessionId,
    provider,
    providerSessionId: session.provider_session_id,
    providerProfile,
    projectPath: session.project_path ?? '',
    jsonlPath: session.jsonl_path,
    title: session.custom_name?.trim() || 'Untitled Session',
    boundary,
  };
};

const previewClaudeFiles = async (context: RewindContext) => {
  if (context.provider !== 'claude') {
    return { canRewind: false, filesChanged: [] as string[] };
  }
  try {
    return await rewindClaudeFiles({
      sessionId: context.providerSessionId,
      cwd: context.projectPath,
      messageId: context.boundary.providerTargetId,
      dryRun: true,
      claudeProviderProfile: context.providerProfile,
    });
  } catch (error) {
    return {
      canRewind: false,
      filesChanged: [] as string[],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const createProviderFork = async (context: RewindContext): Promise<ProviderFork> => {
  if (!context.boundary.forkPointId) {
    throw new Error('An empty rewind boundary does not need a provider fork.');
  }
  if (context.provider === 'claude') {
    return forkClaudeSessionAt({
      sessionId: context.providerSessionId,
      jsonlPath: context.jsonlPath,
      projectPath: context.projectPath,
      upToMessageId: context.boundary.forkPointId,
      title: context.title,
    });
  }
  return forkCodexThreadAt({
    sessionId: context.providerSessionId,
    lastTurnId: context.boundary.forkPointId,
    codexProviderProfile: context.providerProfile,
  }) as Promise<ProviderFork>;
};

export const sessionRewindService = {
  async preview(
    appSessionId: string,
    messageId: string,
    providerProfile: ProviderProfileRuntime | null = null,
  ) {
    const context = await resolveContext(appSessionId, messageId, providerProfile);
    const filePreview = await previewClaudeFiles(context);
    return {
      sessionId: appSessionId,
      provider: context.provider,
      canRestoreConversation: true,
      canRestoreFiles: Boolean(filePreview.canRewind),
      filesChanged: Array.isArray(filePreview.filesChanged) ? filePreview.filesChanged : [],
      insertions: filePreview.insertions ?? 0,
      deletions: filePreview.deletions ?? 0,
      fileRestoreError: filePreview.error ?? null,
    };
  },

  async rewind(
    appSessionId: string,
    input: {
      messageId: string;
      mode: SessionRewindMode;
      providerProfile?: ProviderProfileRuntime | null;
    },
  ) {
    assertMode(input.mode);
    if (rewindsInFlight.has(appSessionId)) {
      throw new AppError('Another rewind is already running for this conversation.', {
        code: 'SESSION_REWIND_IN_PROGRESS',
        statusCode: 409,
      });
    }
    rewindsInFlight.add(appSessionId);
    try {
      const context = await resolveContext(
        appSessionId,
        input.messageId,
        input.providerProfile ?? null,
      );
      const changesConversation = input.mode === 'conversation' || input.mode === 'both';
      const changesFiles = input.mode === 'code' || input.mode === 'both';

      if (changesFiles && context.provider !== 'claude') {
        throw new AppError('Code restore is available only for Claude checkpoints.', {
          code: 'PROVIDER_FILE_REWIND_UNSUPPORTED',
          statusCode: 400,
        });
      }

      let fork: ProviderFork | null = null;
      let staged = false;
      let filesRestored = false;
      try {
        if (changesConversation && context.boundary.forkPointId) {
          fork = await createProviderFork(context);
          try {
            sessionsDb.stageProviderBranch({
              appSessionId,
              provider: context.provider,
              expectedProviderSessionId: context.providerSessionId,
              providerSessionId: fork.sessionId,
              jsonlPath: fork.jsonlPath,
              forkPointId: context.boundary.forkPointId,
            });
            staged = true;
          } catch (error) {
            await bestEffortRemoveFork(fork);
            throw error;
          }
        }

        let fileResult: Awaited<ReturnType<typeof rewindClaudeFiles>> | null = null;
        if (changesFiles) {
          const preview = await previewClaudeFiles(context);
          if (!preview.canRewind) {
            throw new AppError(preview.error || 'No Claude file checkpoint is available here.', {
              code: 'FILE_REWIND_UNAVAILABLE',
              statusCode: 409,
            });
          }
          fileResult = await rewindClaudeFiles({
            sessionId: context.providerSessionId,
            cwd: context.projectPath,
            messageId: context.boundary.providerTargetId,
            dryRun: false,
            claudeProviderProfile: context.providerProfile,
          });
          if (!fileResult.canRewind) {
            throw new AppError(fileResult.error || 'Claude could not restore this checkpoint.', {
              code: 'FILE_REWIND_FAILED',
              statusCode: 409,
            });
          }
          filesRestored = true;
        }

        if (changesConversation) {
          try {
            if (fork && context.boundary.forkPointId) {
              sessionsDb.commitProviderBranchRewind({
                appSessionId,
                provider: context.provider,
                expectedProviderSessionId: context.providerSessionId,
                providerSessionId: fork.sessionId,
                jsonlPath: fork.jsonlPath,
                forkPointId: context.boundary.forkPointId,
              });
            } else {
              sessionsDb.resetProviderBranchForRewind({
                appSessionId,
                provider: context.provider,
                expectedProviderSessionId: context.providerSessionId,
                forkPointId: context.boundary.providerTargetId,
              });
            }
          } catch (error) {
            if (staged && fork && !filesRestored) {
              sessionsDb.abandonProviderBranch(appSessionId, context.provider, fork.sessionId);
            }
            console.error('[SessionRewind] Failed to switch the provider branch.', error);
            throw new AppError(
              filesRestored
                ? 'Files were restored, but the conversation branch could not be switched. Retry conversation rewind.'
                : 'The conversation branch could not be switched.',
              {
                code: filesRestored ? 'REWIND_PARTIAL_RETRYABLE' : 'REWIND_REBIND_FAILED',
                statusCode: 409,
              },
            );
          }

          const rewoundAt = new Date().toISOString();
          broadcastSessionRewound(appSessionId, { truncatedAt: rewoundAt, backupPath: null });
        }

        return {
          sessionId: appSessionId,
          mode: input.mode,
          conversationRewound: changesConversation,
          filesRestored,
          filesChanged: fileResult?.filesChanged ?? [],
        };
      } catch (error) {
        if (staged && fork && !filesRestored) {
          sessionsDb.abandonProviderBranch(appSessionId, context.provider, fork.sessionId);
        }
        throw error;
      }
    } finally {
      rewindsInFlight.delete(appSessionId);
    }
  },
};
