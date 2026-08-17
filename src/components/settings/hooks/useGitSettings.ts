import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  defaultProfileForEntry,
  resolveCatalogModel,
  useProviderSelectionCatalog,
} from '../../../shared/hooks/useProviderSelectionCatalog';
import {
  decodeGitSettingsResponse,
  lowestCommitMessageEffort,
  validateCommitMessageGeneratorSettings,
} from '../../../shared/gitSettings';
import type { CommitMessageGeneratorSettings, LLMProvider } from '../../../types/app';
import { authenticatedFetch } from '../../../utils/api';

type SaveStatus = 'success' | 'error' | null;

/** Owns the one global Settings → Git form and its provider-catalog validation. */
export function useGitSettings() {
  const catalogState = useProviderSelectionCatalog();
  const [gitName, setGitNameState] = useState('');
  const [gitEmail, setGitEmailState] = useState('');
  const [commitMessage, setCommitMessageState] = useState<CommitMessageGeneratorSettings | null>(null);
  const [defaultBasePrompt, setDefaultBasePrompt] = useState('');
  const [basePromptMaxLength, setBasePromptMaxLength] = useState(800);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);

  const clearSaveStatus = useCallback(() => {
    setSaveStatus(null);
    setSaveError(null);
  }, []);

  const loadGitConfig = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await authenticatedFetch('/api/user/git-config');
      const data = await decodeGitSettingsResponse(response);
      setGitNameState(data.gitName ?? '');
      setGitEmailState(data.gitEmail ?? '');
      setCommitMessageState(data.commitMessage);
      setDefaultBasePrompt(data.defaultCommitMessageBasePrompt);
      setBasePromptMaxLength(data.commitMessageBasePromptMaxLength);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load Git settings.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateCommitMessage = useCallback((
    update: (current: CommitMessageGeneratorSettings) => CommitMessageGeneratorSettings,
  ) => {
    clearSaveStatus();
    setCommitMessageState((current) => current ? update(current) : current);
  }, [clearSaveStatus]);

  const changeProvider = useCallback((provider: LLMProvider) => {
    const entry = catalogState.getEntry(provider);
    if (!entry?.available) return;
    const model = resolveCatalogModel(entry, null);
    const modelOption = entry.models.OPTIONS.find((option) => option.value === model) ?? null;
    clearSaveStatus();
    setCommitMessageState({
      provider,
      providerProfileId: defaultProfileForEntry(entry)?.id ?? null,
      model: model ?? '',
      effort: lowestCommitMessageEffort(modelOption),
      basePrompt: commitMessage?.basePrompt ?? defaultBasePrompt,
    });
  }, [catalogState, clearSaveStatus, commitMessage?.basePrompt, defaultBasePrompt]);

  const changeModel = useCallback((model: string) => {
    updateCommitMessage((current) => {
      const entry = catalogState.getEntry(current.provider);
      const option = entry?.models.OPTIONS.find((candidate) => candidate.value === model) ?? null;
      return { ...current, model, effort: lowestCommitMessageEffort(option) };
    });
  }, [catalogState, updateCommitMessage]);

  const validationError = useMemo(() => {
    if (isLoading || catalogState.loading) return null;
    if (loadError) return loadError;
    if (catalogState.error) return catalogState.error;
    if (!gitName.trim() || !gitEmail.trim()) return 'Git name and email are required.';
    return validateCommitMessageGeneratorSettings(
      catalogState.catalog,
      commitMessage,
      basePromptMaxLength,
    );
  }, [
    basePromptMaxLength,
    catalogState.catalog,
    catalogState.error,
    catalogState.loading,
    commitMessage,
    gitEmail,
    gitName,
    isLoading,
    loadError,
  ]);

  const saveGitConfig = useCallback(async () => {
    if (validationError || !commitMessage) {
      setSaveStatus('error');
      setSaveError(validationError ?? 'Choose an available provider before saving.');
      return;
    }
    setIsSaving(true);
    setSaveStatus(null);
    setSaveError(null);
    try {
      const response = await authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitName, gitEmail, commitMessage }),
      });
      const data = await decodeGitSettingsResponse(response);
      setCommitMessageState(data.commitMessage);
      setDefaultBasePrompt(data.defaultCommitMessageBasePrompt);
      setBasePromptMaxLength(data.commitMessageBasePromptMaxLength);
      setSaveStatus('success');
    } catch (error) {
      setSaveStatus('error');
      setSaveError(error instanceof Error ? error.message : 'Failed to save Git settings.');
    } finally {
      setIsSaving(false);
    }
  }, [commitMessage, gitEmail, gitName, validationError]);

  useEffect(() => {
    void loadGitConfig();
  }, [loadGitConfig]);

  return {
    gitName,
    setGitName(value: string) {
      clearSaveStatus();
      setGitNameState(value);
    },
    gitEmail,
    setGitEmail(value: string) {
      clearSaveStatus();
      setGitEmailState(value);
    },
    commitMessage,
    changeProvider,
    changeProfile(providerProfileId: number | null) {
      updateCommitMessage((current) => ({ ...current, providerProfileId }));
    },
    changeModel,
    changeEffort(effort: string | null) {
      updateCommitMessage((current) => ({ ...current, effort }));
    },
    changeBasePrompt(basePrompt: string) {
      updateCommitMessage((current) => ({ ...current, basePrompt }));
    },
    restoreDefaultBasePrompt() {
      updateCommitMessage((current) => ({ ...current, basePrompt: defaultBasePrompt }));
    },
    defaultBasePrompt,
    basePromptMaxLength,
    catalogState,
    isLoading,
    isSaving,
    loadError,
    saveError,
    validationError,
    saveStatus,
    clearSaveStatus,
    retryLoad() {
      catalogState.reload();
      void loadGitConfig();
    },
    saveGitConfig,
  };
}
