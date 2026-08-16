import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { providerProfilesDb } from '@/modules/database/index.js';
import { providerRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import { providerSelectionService } from '@/modules/providers/services/provider-selection.service.js';
import type {
  AnyRecord,
  LLMProvider,
  ProviderProfileProvider,
  ProviderProfileRuntime,
  ProviderRuntimeWriter,
  ProviderTextCompletionInput,
  ProviderTextCompletionResult,
  ProviderTextCompletionService,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const PROFILE_PROVIDERS = new Set<LLMProvider>(['claude', 'codex']);
const CLAUDE_NON_INTERACTIVE_TOOLS = [
  'AskUserQuestion',
  'Bash',
  'Edit',
  'ExitPlanMode',
  'exit_plan_mode',
  'Glob',
  'Grep',
  'NotebookEdit',
  'Read',
  'Skill',
  'Task',
  'TodoRead',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Write',
] as const;

type ProviderTextCompletionErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_PROFILE_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE'
  | 'PROVIDER_UNSUPPORTED_FOR_GENERATION'
  | 'GENERATION_CANCELLED'
  | 'GENERATION_TIMEOUT'
  | 'GENERATION_FAILED';

type ProviderSelectionBoundary = Pick<typeof providerSelectionService, 'validateSelection'>;
type ProviderRuntimeBoundary = Pick<
  typeof providerRuntimeService,
  'abort' | 'hasRuntime' | 'run'
>;
type ProviderProfileBoundary = Pick<typeof providerProfilesDb, 'getProviderProfileForRuntime'>;
type CompletionLogger = {
  info(event: string, metadata: Record<string, unknown>): void;
  warn(event: string, metadata: Record<string, unknown>): void;
};

type ProviderTextCompletionDependencies = {
  selection?: ProviderSelectionBoundary;
  runtime?: ProviderRuntimeBoundary;
  profiles?: ProviderProfileBoundary;
  timeoutMs?: number;
  createRuntimeId?: () => string;
  createTemporaryDirectory?: () => Promise<string>;
  removeTemporaryDirectory?: (directoryPath: string) => Promise<void>;
  logger?: CompletionLogger;
};

const defaultLogger: CompletionLogger = {
  info(event, metadata) {
    console.info(event, metadata);
  },
  warn(event, metadata) {
    console.warn(event, metadata);
  },
};

/**
 * Typed failure returned by the Providers text-completion boundary.
 *
 * Consumer: the Git commit-message service maps these provider-neutral codes
 * onto its HTTP recovery contract without inspecting credentials or runtime
 * implementation errors.
 */
export class ProviderTextCompletionError extends Error {
  readonly code: ProviderTextCompletionErrorCode;
  readonly statusCode: number;

  constructor(code: ProviderTextCompletionErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = 'ProviderTextCompletionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readTextContent(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    return record?.type === 'text' && typeof record.text === 'string'
      ? [record.text]
      : [];
  });
}

function readLegacyAssistantText(event: Record<string, unknown>): string[] {
  if (event.type === 'claude-response') {
    const data = asRecord(event.data);
    const message = asRecord(data?.message) ?? data;
    return readTextContent(message?.content);
  }
  if (event.type === 'assistant') {
    const message = asRecord(event.message);
    return readTextContent(message?.content ?? event.content);
  }
  if (event.type === 'cursor-output' && typeof event.output === 'string') {
    return [event.output];
  }
  if (event.type === 'text' && typeof event.text === 'string' && event.role !== 'user') {
    return [event.text];
  }
  return [];
}

function mapSelectionError(error: AppError): ProviderTextCompletionError {
  switch (error.code) {
    case 'PROVIDER_PROFILE_REQUIRED':
    case 'PROVIDER_PROFILE_AUTH_REQUIRED':
    case 'PROVIDER_PROFILE_NOT_FOUND':
      return new ProviderTextCompletionError(
        'PROVIDER_PROFILE_UNAVAILABLE',
        'The selected provider profile is unavailable.',
        409,
      );
    case 'MODEL_REQUIRED':
    case 'MODEL_NOT_AVAILABLE':
      return new ProviderTextCompletionError(
        'MODEL_UNAVAILABLE',
        'The selected model is unavailable.',
        409,
      );
    case 'PROVIDER_NOT_CONNECTED':
    case 'PROVIDER_PROFILE_UNSUPPORTED':
      return new ProviderTextCompletionError(
        'PROVIDER_UNAVAILABLE',
        error.message,
        409,
      );
    default:
      return new ProviderTextCompletionError(
        'PROVIDER_UNAVAILABLE',
        'The selected provider is unavailable.',
        409,
      );
  }
}

function completionRuntimeOptions(input: {
  provider: LLMProvider;
  model: string;
  runtimeId: string;
  temporaryDirectory: string;
  profile: ProviderProfileRuntime | null;
}): AnyRecord {
  const options: AnyRecord = {
    sessionId: input.runtimeId,
    cwd: input.temporaryDirectory,
    model: input.model,
    permissionMode: 'plan',
    taskMasterReadOnly: true,
    skipPermissions: false,
    images: [],
    files: [],
    toolsSettings: {
      allowedTools: [],
      allowedShellCommands: [],
      disallowedTools: [...CLAUDE_NON_INTERACTIVE_TOOLS],
      skipPermissions: false,
    },
  };
  if (input.provider === 'claude' && input.profile) {
    options.claudeProviderProfile = input.profile;
  }
  if (input.provider === 'codex' && input.profile) {
    options.codexProviderProfile = input.profile;
  }
  return options;
}

/**
 * Creates the isolated, abortable provider text-completion application service.
 *
 * Consumers: Providers tests construct isolated instances with injected
 * adapters; the singleton below is injected into Git by the server entrypoint.
 */
export function createProviderTextCompletionService(
  dependencyOverrides: ProviderTextCompletionDependencies = {},
): ProviderTextCompletionService {
  const selection = dependencyOverrides.selection ?? providerSelectionService;
  const runtimeOverride = dependencyOverrides.runtime;
  const profiles = dependencyOverrides.profiles ?? providerProfilesDb;
  const timeoutMs = dependencyOverrides.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const createRuntimeId = dependencyOverrides.createRuntimeId
    ?? (() => `commit-message-${randomUUID()}`);
  const createTemporaryDirectory = dependencyOverrides.createTemporaryDirectory
    ?? (() => mkdtemp(join(tmpdir(), 'cloudcli-commit-message-')));
  const removeTemporaryDirectory = dependencyOverrides.removeTemporaryDirectory
    ?? ((directoryPath) => rm(directoryPath, { recursive: true, force: true }));
  const logger = dependencyOverrides.logger ?? defaultLogger;

  return {
    async complete(input: ProviderTextCompletionInput): Promise<ProviderTextCompletionResult> {
      // Resolve the default lazily so the Providers barrel can finish its
      // runtime → sessions → websocket → Providers initialization cycle.
      const runtime = runtimeOverride ?? providerRuntimeService;
      const startedAt = Date.now();
      const { provider, providerProfileId, model } = input.selection;
      if (input.signal?.aborted) {
        throw new ProviderTextCompletionError(
          'GENERATION_CANCELLED',
          'Commit-message generation was cancelled.',
          499,
        );
      }

      try {
        await selection.validateSelection({
          userId: input.userId,
          provider,
          providerProfileId,
          model,
        });
      } catch (error) {
        if (error instanceof AppError) throw mapSelectionError(error);
        throw new ProviderTextCompletionError(
          'PROVIDER_UNAVAILABLE',
          'The selected provider could not be validated.',
          409,
        );
      }

      if (!runtime.hasRuntime(provider)) {
        throw new ProviderTextCompletionError(
          'PROVIDER_UNSUPPORTED_FOR_GENERATION',
          `${provider} cannot safely generate commit messages.`,
          409,
        );
      }

      let profile: ProviderProfileRuntime | null = null;
      if (PROFILE_PROVIDERS.has(provider)) {
        if (providerProfileId === null) {
          throw new ProviderTextCompletionError(
            'PROVIDER_PROFILE_UNAVAILABLE',
            'The selected provider profile is unavailable.',
            409,
          );
        }
        profile = profiles.getProviderProfileForRuntime(
          input.userId,
          provider as ProviderProfileProvider,
          providerProfileId,
        );
        if (!profile) {
          throw new ProviderTextCompletionError(
            'PROVIDER_PROFILE_UNAVAILABLE',
            'The selected provider profile is unavailable.',
            409,
          );
        }
      }

      const runtimeId = createRuntimeId();
      const temporaryDirectory = await createTemporaryDirectory();
      const assistantParts: string[] = [];
      const streamParts: string[] = [];
      let terminalFailed = false;
      let abortReason: 'caller' | 'timeout' | null = null;
      let abortRequested = false;
      let rejectAbort: ((error: ProviderTextCompletionError) => void) | null = null;

      const requestAbort = (reason: 'caller' | 'timeout') => {
        if (abortRequested) return;
        abortRequested = true;
        abortReason = reason;
        void runtime.abort(provider, runtimeId).catch(() => false);
        rejectAbort?.(new ProviderTextCompletionError(
          reason === 'caller' ? 'GENERATION_CANCELLED' : 'GENERATION_TIMEOUT',
          reason === 'caller'
            ? 'Commit-message generation was cancelled.'
            : 'Commit-message generation timed out.',
          reason === 'caller' ? 499 : 504,
        ));
      };
      const abortPromise = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      });
      const abortFromCaller = () => requestAbort('caller');
      input.signal?.addEventListener('abort', abortFromCaller, { once: true });
      if (input.signal?.aborted) requestAbort('caller');
      const timeout = setTimeout(() => requestAbort('timeout'), timeoutMs);

      const writer: ProviderRuntimeWriter = {
        userId: null,
        setSessionId: () => undefined,
        send(value) {
          const event = asRecord(value);
          if (!event) return;
          const kind = typeof event.kind === 'string' ? event.kind : null;
          if (kind === 'error') {
            terminalFailed = true;
            return;
          }
          if (kind === 'complete') {
            const exitCode = event.exitCode;
            terminalFailed = terminalFailed
              || event.aborted === true
              || (typeof exitCode === 'number' && exitCode !== 0);
            return;
          }
          if (kind === 'text' && event.role !== 'user' && typeof event.content === 'string') {
            assistantParts.push(event.content);
            return;
          }
          if (kind === 'stream_delta' && typeof event.content === 'string') {
            streamParts.push(event.content);
            return;
          }
          assistantParts.push(...readLegacyAssistantText(event));
        },
      };

      try {
        logger.info('provider_text_completion_started', {
          runtimeId,
          provider,
        });
        await Promise.race([
          runtime.run(
            provider,
            input.prompt,
            completionRuntimeOptions({
              provider,
              model,
              runtimeId,
              temporaryDirectory,
              profile,
            }),
            writer,
          ),
          abortPromise,
        ]);

        if (abortReason) {
          throw new ProviderTextCompletionError(
            abortReason === 'caller' ? 'GENERATION_CANCELLED' : 'GENERATION_TIMEOUT',
            abortReason === 'caller'
              ? 'Commit-message generation was cancelled.'
              : 'Commit-message generation timed out.',
            abortReason === 'caller' ? 499 : 504,
          );
        }
        const text = (assistantParts.length > 0 ? assistantParts : streamParts).join('').trim();
        if (terminalFailed || !text) {
          throw new ProviderTextCompletionError(
            'GENERATION_FAILED',
            'The selected provider returned no usable commit message.',
            502,
          );
        }
        logger.info('provider_text_completion_finished', {
          runtimeId,
          provider,
          durationMs: Date.now() - startedAt,
          outcome: 'success',
        });
        return { text, selection: { ...input.selection } };
      } catch (error) {
        const mapped = error instanceof ProviderTextCompletionError
          ? error
          : new ProviderTextCompletionError(
            'GENERATION_FAILED',
            'The selected provider could not generate a commit message.',
            502,
          );
        logger.warn('provider_text_completion_finished', {
          runtimeId,
          provider,
          durationMs: Date.now() - startedAt,
          outcome: mapped.code,
          cancelled: mapped.code === 'GENERATION_CANCELLED',
          timedOut: mapped.code === 'GENERATION_TIMEOUT',
        });
        throw mapped;
      } finally {
        clearTimeout(timeout);
        input.signal?.removeEventListener('abort', abortFromCaller);
        rejectAbort = null;
        await removeTemporaryDirectory(temporaryDirectory);
      }
    },
  };
}

/**
 * Application singleton exported through the Providers barrel for Git.
 */
export const providerTextCompletionService = createProviderTextCompletionService();
