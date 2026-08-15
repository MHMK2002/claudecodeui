import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isProfileProvider,
  resolveValidSelection,
  useProviderSelectionCatalog,
  validateCatalogSelection,
} from '../hooks/useProviderSelectionCatalog';
import type {
  ClaudeProviderProfilePublic,
  CodexProviderProfilePublic,
  LLMProvider,
  ProviderModelsDefinition,
  ResolvedProviderSelection,
} from '../../types/app';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogTitle,
} from './ui';

export type ProviderModelPickerSelection = ResolvedProviderSelection & {
  /** Whether to carry over an AI summary of the source chat into the fork. */
  carryContext: boolean;
};

export type ProviderModelPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceProvider: LLMProvider;
  sourceProfileId: number | null;
  sourceModel: string | null;
  /** @deprecated Pickers now read profiles from the Settings-backed catalog. */
  claudeProfiles?: ClaudeProviderProfilePublic[];
  /** @deprecated Pickers now read profiles from the Settings-backed catalog. */
  codexProfiles?: CodexProviderProfilePublic[];
  /** @deprecated Pickers now read models from the Settings-backed catalog. */
  providerModelCatalog?: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelsLoading?: boolean;
  claudeProfilesLoading?: boolean;
  codexProfilesLoading?: boolean;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  description?: string;
  onConfirm: (selection: ProviderModelPickerSelection) => void;
};

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

function modelSearchFilter(value: string, search: string): number {
  const haystack = value.toLowerCase();
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token)) ? 1 : 0;
}

export default function ProviderModelPickerDialog({
  open,
  onOpenChange,
  sourceProvider,
  sourceProfileId,
  sourceModel,
  title,
  confirmLabel,
  cancelLabel,
  description,
  onConfirm,
}: ProviderModelPickerDialogProps) {
  const { t } = useTranslation('chat');
  const { catalog, loading, error } = useProviderSelectionCatalog();
  const [selection, setSelection] = useState<ResolvedProviderSelection | null>(null);
  const [carryContext, setCarryContext] = useState(true);

  useEffect(() => {
    if (!open || !catalog) return;
    const sourceSelection = resolveValidSelection(catalog, sourceProvider, {
      profileId: sourceProfileId,
      model: sourceModel,
    });
    const fallback = catalog.providers
      .filter((entry) => entry.available)
      .map((entry) => resolveValidSelection(catalog, entry.provider))
      .find((candidate): candidate is ResolvedProviderSelection => candidate !== null) ?? null;
    setSelection(sourceSelection ?? fallback);
    setCarryContext(true);
  }, [catalog, open, sourceModel, sourceProfileId, sourceProvider]);

  const validationError = useMemo(
    () => selection ? validateCatalogSelection(catalog, selection) : 'Choose an available provider and model.',
    [catalog, selection],
  );

  const handleConfirm = useCallback(() => {
    if (!selection || validationError) return;
    onConfirm({ ...selection, carryContext });
    onOpenChange(false);
  }, [carryContext, onConfirm, onOpenChange, selection, validationError]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="border-b border-border/60 bg-muted/20 px-4 py-3">
          <DialogTitle>
            {title ?? t('providerSelection.forkDialogTitle', { defaultValue: 'Fork session' })}
          </DialogTitle>
          <p className="text-sm font-semibold text-foreground">
            {title ?? t('providerSelection.forkDialogTitle', { defaultValue: 'Fork session' })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {description ?? t('providerSelection.forkDialogDescription', {
              defaultValue: 'Choose the provider, Settings profile, and model for the new session.',
            })}
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
          <CommandInput placeholder={t('providerSelection.searchModels', { defaultValue: 'Search models…' })} />
          <CommandList className="max-h-[350px]">
            <CommandEmpty>
              {loading
                ? t('providerSelection.loadingModels', { defaultValue: 'Loading providers…' })
                : error ?? t('providerSelection.noModelsFound', { defaultValue: 'No models found.' })}
            </CommandEmpty>
            {(catalog?.providers ?? []).flatMap((entry) => {
              if (!entry.available) {
                return [(
                  <CommandGroup key={entry.provider} heading={PROVIDER_LABELS[entry.provider]}>
                    <CommandItem disabled className="text-muted-foreground">
                      {entry.unavailableReason ?? 'Configure this provider in Settings.'}
                    </CommandItem>
                  </CommandGroup>
                )];
              }

              const targets = isProfileProvider(entry.provider)
                ? entry.profiles.map((profile) => ({ profileId: profile.id, label: profile.title }))
                : [{ profileId: null, label: PROVIDER_LABELS[entry.provider] }];

              return targets.map((target) => (
                <CommandGroup
                  key={`${entry.provider}-${target.profileId ?? 'connection'}`}
                  heading={isProfileProvider(entry.provider)
                    ? `${PROVIDER_LABELS[entry.provider]} · ${target.label}`
                    : target.label}
                >
                  {entry.models.OPTIONS.map((modelOption) => {
                    const selected = selection?.provider === entry.provider
                      && selection.providerProfileId === target.profileId
                      && selection.model === modelOption.value;
                    return (
                      <CommandItem
                        key={`${entry.provider}-${target.profileId ?? 'connection'}-${modelOption.value}`}
                        value={`${PROVIDER_LABELS[entry.provider]} ${target.label} ${modelOption.label} ${modelOption.description ?? ''}`}
                        onSelect={() => setSelection({
                          provider: entry.provider,
                          providerProfileId: target.profileId,
                          model: modelOption.value,
                        })}
                      >
                        <span className="min-w-0 flex-1 truncate">{modelOption.label}</span>
                        {selected ? <span className="ml-auto h-2 w-2 rounded-full bg-primary" aria-hidden /> : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ));
            })}
          </CommandList>
        </Command>

        {validationError && !loading ? (
          <p role="alert" className="border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
            {validationError}
          </p>
        ) : null}

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
            disabled={Boolean(validationError) || loading}
            onClick={handleConfirm}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmLabel ?? t('providerSelection.forkDialogConfirm', { defaultValue: 'Fork' })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
