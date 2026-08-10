import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import { providerProfilesDb } from '@/modules/database/index.js';
import { CODEX_MODEL_PROVIDER_ID } from '@/modules/providers/list/codex/codex-runtime.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import type {
  CodexProviderProfileRuntime,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';

import {
  buildCleanupInput,
  type CleanupDecision,
} from '../../../../../shared/voice-cleanup-contract.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');
const REASONING_EFFORT_ORDER = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

type FetchLike = typeof fetch;

type CodexResponsesProvider = {
  baseUrl: string;
  apiKey: string;
};

export type CodexVoiceCleanupInput = {
  userId: number;
  providerProfileId: number | null;
  model: string;
  transcript: string;
  instructions: string;
  signal?: AbortSignal;
};

export type CodexVoiceCleanupResult = {
  decision: CleanupDecision;
  model: string;
  inputTokens: number | null;
};

type CodexVoiceCleanupDependencies = {
  fetchFn?: FetchLike;
  getModels?: () => Promise<ProviderModelsDefinition>;
  getProfile?: (userId: number, profileId: number) => CodexProviderProfileRuntime | null;
  readDefaultConfig?: () => Promise<unknown>;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

export class CodexVoiceCleanupError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 502) {
    super(message);
    this.name = 'CodexVoiceCleanupError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function assertSafeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CodexVoiceCleanupError('INVALID_PROVIDER_URL', 'Codex provider URL is invalid.', 400);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new CodexVoiceCleanupError('INVALID_PROVIDER_URL', 'Codex provider URL is invalid.', 400);
  }
  if (parsed.hostname === '169.254.169.254' || parsed.hostname.startsWith('169.254.')) {
    throw new CodexVoiceCleanupError('INVALID_PROVIDER_URL', 'Codex provider URL is blocked.', 400);
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function resolveDefaultCodexResponsesProvider(
  configValue: unknown,
  env: NodeJS.ProcessEnv,
): CodexResponsesProvider {
  const config = asRecord(configValue);
  const providers = asRecord(config?.model_providers);
  const provider = asRecord(providers?.[CODEX_MODEL_PROVIDER_ID]);
  if (!provider || provider.requires_openai_auth === true) {
    throw new CodexVoiceCleanupError(
      'DEFAULT_PROVIDER_UNAVAILABLE',
      'Default Codex provider does not expose Responses credentials.',
      503,
    );
  }

  const wireApi = readString(provider.wire_api);
  if (wireApi && wireApi !== 'responses') {
    throw new CodexVoiceCleanupError(
      'RESPONSES_UNSUPPORTED',
      'Selected Codex provider does not support the Responses API.',
      400,
    );
  }
  const baseUrl = readString(provider.base_url);
  const envKey = readString(provider.env_key);
  const apiKey = envKey ? readString(env[envKey]) : null;
  if (!baseUrl || !apiKey) {
    throw new CodexVoiceCleanupError(
      'DEFAULT_PROVIDER_UNAVAILABLE',
      'Default Codex provider is not fully configured.',
      503,
    );
  }
  return { baseUrl: assertSafeBaseUrl(baseUrl), apiKey };
}

function resolveCustomCodexResponsesProvider(
  profile: CodexProviderProfileRuntime | null,
): CodexResponsesProvider {
  if (!profile || !profile.isActive || !profile.baseUrl || !profile.secretValue.trim()) {
    throw new CodexVoiceCleanupError(
      'PROFILE_NOT_FOUND',
      'Codex provider profile was not found or is inactive.',
      404,
    );
  }
  return {
    baseUrl: assertSafeBaseUrl(profile.baseUrl),
    apiKey: profile.secretValue.trim(),
  };
}

function responsesUrl(baseUrl: string): string {
  return baseUrl.endsWith('/responses') ? baseUrl : `${baseUrl}/responses`;
}

export function selectCodexCleanupModel(
  definition: ProviderModelsDefinition,
  requestedModel: string,
): ProviderModelOption {
  const normalized = requestedModel.trim();
  const selected = definition.OPTIONS.find((option) => option.value === normalized);
  if (!selected) {
    throw new CodexVoiceCleanupError(
      'MODEL_UNSUPPORTED',
      'Selected Codex cleanup model is not supported.',
      400,
    );
  }
  return selected;
}

export function selectLowestReasoningEffort(option: ProviderModelOption): string | null {
  const supported = new Set(option.effort?.values.map((entry) => entry.value) ?? []);
  return REASONING_EFFORT_ORDER.find((effort) => supported.has(effort)) ?? null;
}

export function extractResponsesOutputText(value: unknown): string | null {
  const response = asRecord(value);
  const direct = readString(response?.output_text);
  if (direct) return direct;
  const output = Array.isArray(response?.output) ? response.output : [];
  const parts: string[] = [];
  for (const itemValue of output) {
    const item = asRecord(itemValue);
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const partValue of content) {
      const part = asRecord(partValue);
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
  }
  const joined = parts.join('');
  return joined.trim() ? joined : null;
}

function readInputTokenCount(value: unknown): number | null {
  const response = asRecord(value);
  const usage = asRecord(response?.usage);
  return typeof usage?.input_tokens === 'number' && Number.isFinite(usage.input_tokens)
    ? usage.input_tokens
    : null;
}

function maxOutputTokensFor(transcript: string): number {
  return Math.min(32_000, Math.max(256, Math.ceil(transcript.length * 2)));
}

export const createCodexVoiceCleanupService = (
  dependencies: CodexVoiceCleanupDependencies = {},
) => {
  const fetchFn = dependencies.fetchFn ?? globalThis.fetch;
  const getModels = dependencies.getModels ?? (async () => (
    await providerModelsService.getProviderModels('codex')
  ).models);
  const getProfile = dependencies.getProfile ?? ((userId, profileId) => (
    providerProfilesDb.getCodexProfileForRuntime(userId, profileId)
  ));
  const readDefaultConfig = dependencies.readDefaultConfig ?? (async () => (
    TOML.parse(await readFile(CODEX_CONFIG_PATH, 'utf8'))
  ));
  const env = dependencies.env ?? process.env;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const cleanup = async (input: CodexVoiceCleanupInput): Promise<CodexVoiceCleanupResult> => {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (input.signal?.aborted) controller.abort();
    else input.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const definition = await getModels();
      const selectedModel = selectCodexCleanupModel(definition, input.model);
      const effort = selectLowestReasoningEffort(selectedModel);
      const provider = input.providerProfileId === null
        ? resolveDefaultCodexResponsesProvider(await readDefaultConfig(), env)
        : resolveCustomCodexResponsesProvider(getProfile(input.userId, input.providerProfileId));
      const body = {
        model: selectedModel.value,
        input: buildCleanupInput(input.transcript, input.instructions),
        ...(effort ? { reasoning: { effort } } : {}),
        text: { verbosity: 'low' },
        tools: [],
        store: false,
        max_output_tokens: maxOutputTokensFor(input.transcript),
      };
      const response = await fetchFn(responsesUrl(provider.baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new CodexVoiceCleanupError('UPSTREAM_REJECTED', 'Codex cleanup request failed.');
      }
      const payload = await response.json().catch(() => null);
      const output = extractResponsesOutputText(payload);
      if (!output) {
        throw new CodexVoiceCleanupError('INVALID_RESPONSE', 'Codex cleanup returned no text.');
      }
      const decision: CleanupDecision = output === input.transcript
        ? { action: 'keep' }
        : { action: 'edit', text: output };
      return {
        decision,
        model: selectedModel.value,
        inputTokens: readInputTokenCount(payload),
      };
    } catch (error) {
      if (error instanceof CodexVoiceCleanupError) throw error;
      if (controller.signal.aborted) {
        throw new CodexVoiceCleanupError(
          input.signal?.aborted ? 'CANCELLED' : 'TIMEOUT',
          'Codex cleanup request was cancelled.',
          input.signal?.aborted ? 499 : 504,
        );
      }
      throw new CodexVoiceCleanupError('UPSTREAM_UNAVAILABLE', 'Codex cleanup is unavailable.');
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abortFromCaller);
    }
  };

  return { cleanup };
};

export const codexVoiceCleanupService = createCodexVoiceCleanupService();
