import type {
  CommitMessageGeneratorSettings,
  LLMProvider,
  ProviderModelOption,
  ProviderSelectionCatalog,
} from '../types/app';

import { validateCatalogSelection } from './hooks/useProviderSelectionCatalog';

const PROVIDERS = new Set<LLMProvider>(['claude', 'codex', 'cursor', 'opencode']);
const LOW_TOKEN_EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export type GitSettingsResponse = {
  success: true;
  gitName: string | null;
  gitEmail: string | null;
  commitMessage: CommitMessageGeneratorSettings | null;
  defaultCommitMessageBasePrompt: string;
  commitMessageBasePromptMaxLength: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonContentType(value: string | null): boolean {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

function parseGenerator(value: unknown): CommitMessageGeneratorSettings | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (
    !PROVIDERS.has(value.provider as LLMProvider)
    || !(value.providerProfileId === null || (Number.isInteger(value.providerProfileId) && Number(value.providerProfileId) > 0))
    || typeof value.model !== 'string'
    || !value.model.trim()
    || !(value.effort === null || (typeof value.effort === 'string' && value.effort.trim()))
    || typeof value.basePrompt !== 'string'
  ) {
    return undefined;
  }
  return {
    provider: value.provider as LLMProvider,
    providerProfileId: value.providerProfileId as number | null,
    model: value.model,
    effort: value.effort as string | null,
    basePrompt: value.basePrompt,
  };
}

/** Decodes the shared Settings response used by Settings → Git and Source Control. */
export async function decodeGitSettingsResponse(response: Response): Promise<GitSettingsResponse> {
  if (!isJsonContentType(response.headers.get('content-type'))) {
    throw new Error(response.ok
      ? 'Git settings returned an unsupported response.'
      : `Git settings request failed (${response.status}).`);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('Git settings returned invalid JSON.');
  }
  const payload = isRecord(value) ? value : null;
  if (!response.ok || payload?.success !== true) {
    const message = typeof payload?.error === 'string' ? payload.error : null;
    throw new Error(message || `Git settings request failed (${response.status}).`);
  }
  const generator = parseGenerator(payload.commitMessage);
  if (
    generator === undefined
    || !(payload.gitName === null || typeof payload.gitName === 'string')
    || !(payload.gitEmail === null || typeof payload.gitEmail === 'string')
    || typeof payload.defaultCommitMessageBasePrompt !== 'string'
    || !Number.isInteger(payload.commitMessageBasePromptMaxLength)
    || Number(payload.commitMessageBasePromptMaxLength) <= 0
  ) {
    throw new Error('Git settings response has an invalid schema.');
  }
  return {
    success: true,
    gitName: payload.gitName as string | null,
    gitEmail: payload.gitEmail as string | null,
    commitMessage: generator,
    defaultCommitMessageBasePrompt: payload.defaultCommitMessageBasePrompt,
    commitMessageBasePromptMaxLength: Number(payload.commitMessageBasePromptMaxLength),
  };
}

/** Chooses the least expensive supported effort for a newly selected model. */
export function lowestCommitMessageEffort(model: ProviderModelOption | null): string | null {
  const values = model?.effort?.values.map((entry) => entry.value) ?? [];
  return LOW_TOKEN_EFFORT_ORDER.find((candidate) => values.includes(candidate))
    ?? model?.effort?.default
    ?? values[0]
    ?? null;
}

/** Validates Settings selection, effort, and style-prompt bounds before Save. */
export function validateCommitMessageGeneratorSettings(
  catalog: ProviderSelectionCatalog | null,
  settings: CommitMessageGeneratorSettings | null,
  maximumPromptLength: number,
): string | null {
  if (!settings) return 'Choose an available provider before saving.';
  const selectionError = validateCatalogSelection(catalog, settings);
  if (selectionError) return selectionError;
  const entry = catalog?.providers.find((candidate) => candidate.provider === settings.provider);
  const model = entry?.models.OPTIONS.find((option) => option.value === settings.model) ?? null;
  const efforts = model?.effort?.values.map((effort) => effort.value) ?? [];
  if (efforts.length > 0 && (!settings.effort || !efforts.includes(settings.effort))) {
    return 'Choose an available effort for this model.';
  }
  if (efforts.length === 0 && settings.effort !== null) {
    return 'This model does not support an effort setting.';
  }
  if (settings.basePrompt.length > maximumPromptLength) {
    return `Shorten the base prompt to ${maximumPromptLength} characters.`;
  }
  return null;
}
