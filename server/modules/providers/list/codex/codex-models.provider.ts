import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';
import crossSpawn from 'cross-spawn';

import { CODEX_MODEL_PROVIDER_CONFIG_OVERRIDE } from '@/modules/providers/list/codex/codex-runtime.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

export const CODEX_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-5.6',
      label: 'GPT-5.6',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.5',
      label: 'GPT-5.5',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4',
      label: 'GPT-5.4',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
  ],
  DEFAULT: 'gpt-5.6',
};

const CODEX_MODELS_TIMEOUT_MS = 10_000;
const CODEX_APP_SERVER_INITIALIZE_REQUEST_ID = 1;
const CODEX_APP_SERVER_MODEL_LIST_REQUEST_ID = 2;
const spawnFunction = crossSpawn;

export type CodexAppServerModel = {
  id?: string;
  model?: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: string;
    description?: string;
  }>;
};

type CodexCachedModel = {
  slug?: string;
  display_name?: string;
  description?: string;
  priority?: number;
  visibility?: string;
  supported_in_api?: boolean;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{
    effort?: string;
    description?: string;
  }>;
};

const CODEX_MODELS_CACHE_PATH = path.join(os.homedir(), '.codex', 'models_cache.json');
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

const isCodexCachedModel = (value: unknown): value is CodexCachedModel => {
  const record = readObjectRecord(value);
  return Boolean(record && readOptionalString(record.slug));
};

const readCodexPriority = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
);

export const buildCodexDefinitionFromAppServerModels = (
  models: CodexAppServerModel[],
): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();
  let defaultValue: string | null = null;

  for (const model of models) {
    const value = readOptionalString(model.model) ?? readOptionalString(model.id);
    if (!value || model.hidden === true || seenValues.has(value)) {
      continue;
    }

    const effortValues = (model.supportedReasoningEfforts ?? [])
      .map((effort) => {
        const effortValue = readOptionalString(effort.reasoningEffort);
        if (!effortValue) {
          return null;
        }

        return {
          value: effortValue,
          description: readOptionalString(effort.description),
        };
      })
      .filter((effort): effort is NonNullable<typeof effort> => Boolean(effort));
    const configuredDefaultEffort = readOptionalString(model.defaultReasoningEffort);

    seenValues.add(value);
    options.push({
      value,
      label: readOptionalString(model.displayName) ?? value,
      description: readOptionalString(model.description),
      effort: effortValues.length > 0
        ? {
            default: configuredDefaultEffort && effortValues.some((effort) => effort.value === configuredDefaultEffort)
              ? configuredDefaultEffort
              : undefined,
            values: effortValues,
          }
        : undefined,
    });

    if (model.isDefault === true) {
      defaultValue = value;
    }
  }

  if (options.length === 0) {
    return CODEX_FALLBACK_MODELS;
  }

  return {
    OPTIONS: options,
    DEFAULT: defaultValue ?? options[0].value,
  };
};

const runCodexModelList = (): Promise<CodexAppServerModel[]> => new Promise((resolve, reject) => {
  const codexProcess = spawnFunction(
    'codex',
    ['-c', CODEX_MODEL_PROVIDER_CONFIG_OVERRIDE, 'app-server', '--stdio'],
    {
      cwd: process.cwd(),
      env: { ...process.env },
    },
  );

  let stdoutBuffer = '';
  let stderr = '';
  let settled = false;

  const finish = (error: Error | null, models: CodexAppServerModel[] = []) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timer);
    if (!codexProcess.killed) {
      codexProcess.kill('SIGTERM');
    }

    if (error) {
      reject(error);
      return;
    }

    resolve(models);
  };

  const send = (message: object) => {
    if (!codexProcess.stdin) {
      finish(new Error('Codex app-server has no stdin'));
      return;
    }

    codexProcess.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const timer = setTimeout(() => {
    finish(new Error('Codex model discovery timed out'));
  }, CODEX_MODELS_TIMEOUT_MS);

  codexProcess.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      let message: Record<string, unknown> | null = null;
      try {
        message = readObjectRecord(JSON.parse(line));
      } catch {
        finish(new Error('Codex app-server returned malformed JSON'));
        return;
      }

      if (!message) {
        continue;
      }

      const error = readObjectRecord(message.error);
      if (error) {
        finish(new Error(readOptionalString(error.message) ?? 'Codex app-server request failed'));
        return;
      }

      if (message.id === CODEX_APP_SERVER_INITIALIZE_REQUEST_ID) {
        send({ method: 'initialized', params: {} });
        send({
          id: CODEX_APP_SERVER_MODEL_LIST_REQUEST_ID,
          method: 'model/list',
          params: { includeHidden: false, limit: 100 },
        });
        continue;
      }

      if (message.id !== CODEX_APP_SERVER_MODEL_LIST_REQUEST_ID) {
        continue;
      }

      const result = readObjectRecord(message.result);
      const data = Array.isArray(result?.data) ? result.data : [];
      const models = data
        .map((value) => readObjectRecord(value) as CodexAppServerModel | null)
        .filter((value): value is CodexAppServerModel => Boolean(value));
      finish(null, models);
    }
  });

  codexProcess.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  codexProcess.on('error', (error) => {
    finish(error instanceof Error ? error : new Error(String(error)));
  });

  codexProcess.on('close', (code) => {
    if (!settled) {
      finish(new Error(stderr.trim() || `Codex app-server exited with code ${code}`));
    }
  });

  send({
    id: CODEX_APP_SERVER_INITIALIZE_REQUEST_ID,
    method: 'initialize',
    params: {
      clientInfo: {
        name: 'cloudcli',
        version: '1.0.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    },
  });
});

const mapCodexModel = (model: CodexCachedModel): ProviderModelOption => {
  const effortValues = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels
      .map((level) => {
        const value = readOptionalString(level?.effort);
        if (!value) {
          return null;
        }

        return {
          value,
          description: readOptionalString(level?.description),
        };
      })
      .filter((level): level is NonNullable<typeof level> => Boolean(level))
    : [];

  return {
    value: model.slug as string,
    label: readOptionalString(model.display_name) ?? (model.slug as string),
    description: readOptionalString(model.description),
    effort: effortValues.length > 0
      ? {
          default: readOptionalString(model.default_reasoning_level) ?? undefined,
          values: effortValues,
        }
      : undefined,
  };
};

const buildCodexModelsDefinition = (models: CodexCachedModel[]): ProviderModelsDefinition => {
  const sortedModels = [...models]
    .filter((model) => model.visibility === 'list' && model.supported_in_api !== false)
    .sort((left, right) => readCodexPriority(left.priority) - readCodexPriority(right.priority));

  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of sortedModels) {
    const mappedModel = mapCodexModel(model);
    if (seenValues.has(mappedModel.value)) {
      continue;
    }

    seenValues.add(mappedModel.value);
    options.push(mappedModel);
  }

  if (options.length === 0) {
    return CODEX_FALLBACK_MODELS;
  }

  return {
    OPTIONS: options,
    DEFAULT: options[0]?.value ?? CODEX_FALLBACK_MODELS.DEFAULT,
  };
};

export class CodexProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const appServerModels = await runCodexModelList();
      if (appServerModels.length > 0) {
        return buildCodexDefinitionFromAppServerModels(appServerModels);
      }
    } catch (error) {
      console.warn('[Codex] Unable to discover models through app-server:', error);
    }

    try {
      const raw = await readFile(CODEX_MODELS_CACHE_PATH, 'utf8');
      const parsed = readObjectRecord(JSON.parse(raw));
      const models = Array.isArray(parsed?.models)
        ? parsed.models.filter(isCodexCachedModel)
        : [];

      return buildCodexModelsDefinition(models);
    } catch {
      return CODEX_FALLBACK_MODELS;
    }
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    try {
      const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (!model) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      return {
        model,
      };
    } catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }
}
