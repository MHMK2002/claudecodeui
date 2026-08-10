import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  LLMProvider,
  ProviderModelsDefinition,
  ClaudeProviderProfilePublic,
  CodexProviderProfilePublic,
} from '../../types/app';

import {
  Dialog,
  DialogContent,
  DialogTitle,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from './ui';

export type ProviderModelPickerSelection = {
  provider: LLMProvider;
  providerProfileId: number | null;
  /** null = "leave model unchanged"; callers fall back to the source/default. */
  model: string | null;
  /** Whether to carry over an AI summary of the source chat into the fork. */
  carryContext: boolean;
};

export type ProviderModelPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceProvider: LLMProvider;
  sourceProfileId: number | null;
  /**
   * The model the source session is currently using. Pre-selected in the
   * dialog; pass null when unknown.
   */
  sourceModel: string | null;
  claudeProfiles: ClaudeProviderProfilePublic[];
  codexProfiles: CodexProviderProfilePublic[];
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelsLoading: boolean;
  claudeProfilesLoading: boolean;
  codexProfilesLoading: boolean;
  /** Override the dialog header. Falls back to a translated default. */
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  description?: string;
  onConfirm: (selection: ProviderModelPickerSelection) => void;
};

const PROVIDER_META: { id: LLMProvider; name: string }[] = [
  { id: 'claude', name: 'Anthropic' },
  { id: 'codex', name: 'OpenAI' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'opencode', name: 'OpenCode' },
];

// cmdk's default fuzzy filter surfaces unrelated models — e.g. searching
// "chatgpt" also matched "Fable". Require every whitespace-separated token to
// appear as a literal substring instead.
function modelSearchFilter(value: string, search: string): number {
  const haystack = value.toLowerCase();
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token)) ? 1 : 0;
}

type ProviderGroup = {
  id: LLMProvider;
  name: string;
  profileId?: number | null;
  models: { value: string; label: string; description?: string }[];
};

function getModelConfig(
  p: LLMProvider,
  catalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>,
): ProviderModelsDefinition {
  const entry = catalog[p];
  return entry ?? { OPTIONS: [], DEFAULT: '' };
}

function isProfileProvider(p: LLMProvider): p is 'claude' | 'codex' {
  return p === 'claude' || p === 'codex';
}

function defaultProfileIdForProvider(
  provider: LLMProvider,
  sourceProfileId: number | null,
  claudeProfiles: ClaudeProviderProfilePublic[],
  codexProfiles: CodexProviderProfilePublic[],
): number | null {
  if (!isProfileProvider(provider)) return null;
  const profiles = provider === 'claude' ? claudeProfiles : codexProfiles;
  const activeProfiles = profiles.filter((p) => p.isActive);
  // Preserve the source profile if it's still valid for the target provider;
  // Claude and Codex keep independent id spaces, so cross-provider reuse
  // can't happen — we still defensively check.
  if (sourceProfileId !== null) {
    const matching = activeProfiles.find((p) => p.id === sourceProfileId);
    if (matching) return matching.id;
  }
  const defaultProfile = activeProfiles.find((p) => p.isDefault);
  return defaultProfile?.id ?? null;
}

export default function ProviderModelPickerDialog({
  open,
  onOpenChange,
  sourceProvider,
  sourceProfileId,
  sourceModel,
  claudeProfiles,
  codexProfiles,
  providerModelCatalog,
  providerModelsLoading,
  claudeProfilesLoading,
  codexProfilesLoading,
  title,
  confirmLabel,
  cancelLabel,
  description,
  onConfirm,
}: ProviderModelPickerDialogProps) {
  const { t } = useTranslation('chat');

  const [provider, setProvider] = useState<LLMProvider>(sourceProvider);
  const [profileId, setProfileId] = useState<number | null>(sourceProfileId);
  const [model, setModel] = useState<string | null>(sourceModel);
  const [carryContext, setCarryContext] = useState(true);

  // When the dialog re-opens with new source values (e.g. user closed it,
  // switched source sessions, and reopened), reset selection.
  React.useEffect(() => {
    if (!open) return;
    setProvider(sourceProvider);
    setProfileId(sourceProfileId);
    setModel(sourceModel);
    setCarryContext(true);
  }, [open, sourceProvider, sourceProfileId, sourceModel]);

  const handleProviderChange = useCallback(
    (next: LLMProvider) => {
      setProvider(next);
      // Re-resolve a sensible default profile for the new provider.
      setProfileId(
        defaultProfileIdForProvider(next, sourceProfileId, claudeProfiles, codexProfiles),
      );
    },
    [sourceProfileId, claudeProfiles, codexProfiles],
  );

  const visibleProviderGroups = useMemo<ProviderGroup[]>(() => {
    return PROVIDER_META.flatMap((p) => {
      const models = providerModelCatalog[p.id]?.OPTIONS ?? [];
      if (!isProfileProvider(p.id)) {
        return [{ id: p.id, name: p.name, models }];
      }

      const providerLabel = p.id === 'claude' ? 'Claude' : 'Codex';
      const profiles = p.id === 'claude' ? claudeProfiles : codexProfiles;
      const localGroup: ProviderGroup = {
        id: p.id,
        name: `${providerLabel} - Local CLI`,
        profileId: null,
        models,
      };
      const profileGroups = profiles
        .filter((profile) => profile.isActive)
        .map<ProviderGroup>((profile) => ({
          id: p.id,
          name: `${providerLabel} - ${profile.title}`,
          profileId: profile.id,
          models,
        }));

      return [localGroup, ...profileGroups];
    });
  }, [claudeProfiles, codexProfiles, providerModelCatalog]);

  const currentModelLabel = useMemo(() => {
    if (model === null) {
      return t('providerSelection.modelUnchanged', {
        defaultValue: 'Same as source',
      });
    }
    const config = getModelConfig(provider, providerModelCatalog);
    const found = config.OPTIONS.find((o) => o.value === model);
    return found?.label || model;
  }, [provider, model, providerModelCatalog, t]);

  const handleConfirm = useCallback(() => {
    onConfirm({ provider, providerProfileId: profileId, model, carryContext });
    onOpenChange(false);
  }, [onConfirm, onOpenChange, provider, profileId, model, carryContext]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <DialogTitle>
          {title ?? t('providerSelection.forkDialogTitle', { defaultValue: 'Fork session' })}
        </DialogTitle>
        <div className="border-b border-border/60 bg-muted/20 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">
            {title ?? t('providerSelection.forkDialogTitle', { defaultValue: 'Fork session' })}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {description ?? t('providerSelection.forkDialogDescription', {
              defaultValue: 'Choose the provider and model for the new session.',
            })}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t('providerSelection.forkDialogModelNote', {
              defaultValue: 'Leave unchanged to use the current model.',
            })}
            {' · '}
            <span className="font-medium text-foreground/80">{currentModelLabel}</span>
          </p>
          <label className="mt-3 flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={carryContext}
              onChange={(event) => setCarryContext(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input bg-card text-primary focus:ring-2 focus:ring-primary"
            />
            <span className="text-[11px] leading-snug text-muted-foreground">
              {t('providerSelection.forkDialogCarryContext', {
                defaultValue: 'Carry over a summary of this chat so the new session has context.',
              })}
            </span>
          </label>
        </div>

        <Command filter={modelSearchFilter}>
          <CommandInput
            placeholder={t('providerSelection.searchModels', {
              defaultValue: 'Search models...',
            })}
          />
          <CommandList className="max-h-[350px]">
            <CommandEmpty>
              {t('providerSelection.noModelsFound', {
                defaultValue: 'No models found.',
              })}
            </CommandEmpty>
            {visibleProviderGroups.map((group, idx) => {
              const groupProfileId = group.profileId ?? null;
              const isSelected = provider === group.id && profileId === groupProfileId;
              return (
                <CommandGroup
                  key={`${group.id}-${groupProfileId ?? 'local'}`}
                  className={
                    idx > 0
                      ? 'border-t border-border/40 [&_[cmdk-group-heading]]:mt-1 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider'
                      : '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider'
                  }
                  heading={
                    <span className="flex items-center gap-1.5">
                      {group.name}
                    </span>
                  }
                >
                  {group.models.length === 0 &&
                  (providerModelsLoading ||
                    (group.id === 'claude' && claudeProfilesLoading) ||
                    (group.id === 'codex' && codexProfilesLoading)) ? (
                    <CommandItem disabled className="ml-4 border-l border-border/40 pl-4 text-muted-foreground">
                      {t('providerSelection.loadingModels', { defaultValue: 'Loading models…' })}
                    </CommandItem>
                  ) : null}
                  {group.models.map((modelOption) => {
                    const isModelSelected = isSelected && model === modelOption.value;
                    return (
                      <CommandItem
                        key={`${group.id}-${groupProfileId ?? 'local'}-${modelOption.value}`}
                        value={`${group.name} ${modelOption.label} ${modelOption.description || ''}`}
                        onSelect={() => {
                          handleProviderChange(group.id);
                          setProfileId(groupProfileId);
                          setModel(modelOption.value);
                        }}
                        className="ml-4 border-l border-border/40 pl-4"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{modelOption.label}</div>
                        </div>
                        {isModelSelected ? (
                          <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/10 px-4 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {cancelLabel ?? t('providerSelection.forkDialogCancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {confirmLabel ?? t('providerSelection.forkDialogConfirm', { defaultValue: 'Fork' })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
