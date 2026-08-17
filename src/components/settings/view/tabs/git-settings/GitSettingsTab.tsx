import {
  AlertCircle,
  Check,
  GitCommitHorizontal,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useGitSettings } from '../../../hooks/useGitSettings';
import type { LLMProvider } from '../../../../../types/app';
import { Button, Input } from '../../../../../shared/view/ui';
import SettingsCard from '../../SettingsCard';
import SettingsSection from '../../SettingsSection';

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

const selectClass = 'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';

export default function GitSettingsTab() {
  const { t } = useTranslation('settings');
  const settings = useGitSettings();
  const selectedEntry = settings.commitMessage
    ? settings.catalogState.getEntry(settings.commitMessage.provider)
    : null;
  const selectedModel = selectedEntry?.models.OPTIONS.find(
    (option) => option.value === settings.commitMessage?.model,
  ) ?? null;
  const effortOptions = selectedModel?.effort?.values ?? [];
  const profileRequired = settings.commitMessage?.provider === 'claude'
    || settings.commitMessage?.provider === 'codex';
  const saveDisabled = settings.isLoading
    || settings.isSaving
    || settings.catalogState.loading
    || Boolean(settings.validationError);

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('git.title')}
        description={t('git.description')}
      >
        <div className="space-y-5">
          <SettingsCard className="p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
                <GitCommitHorizontal className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t('git.identity.title', { defaultValue: 'Commit identity' })}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t('git.identity.description', { defaultValue: 'Used by Git for commits on this device.' })}
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="settings-git-name" className="mb-2 block text-sm font-medium text-foreground">
                  {t('git.name.label')}
                </label>
                <Input
                  id="settings-git-name"
                  type="text"
                  value={settings.gitName}
                  onChange={(event) => settings.setGitName(event.target.value)}
                  placeholder="John Doe"
                  disabled={settings.isLoading}
                  className="min-h-11 w-full"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t('git.name.help')}</p>
              </div>

              <div>
                <label htmlFor="settings-git-email" className="mb-2 block text-sm font-medium text-foreground">
                  {t('git.email.label')}
                </label>
                <Input
                  id="settings-git-email"
                  type="email"
                  value={settings.gitEmail}
                  onChange={(event) => settings.setGitEmail(event.target.value)}
                  placeholder="john@example.com"
                  disabled={settings.isLoading}
                  className="min-h-11 w-full"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t('git.email.help')}</p>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard className="relative overflow-hidden border-primary/25 bg-gradient-to-br from-card via-card to-primary/[0.06] shadow-sm">
            <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
            <div className="relative border-b border-border/70 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="bg-primary/12 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-primary ring-1 ring-primary/20">
                    <Sparkles className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-foreground">
                        {t('git.generator.title', { defaultValue: 'Commit message generator' })}
                      </h3>
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        {t('git.generator.globalBadge', { defaultValue: 'Global · all projects' })}
                      </span>
                    </div>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                      {t('git.generator.description', {
                        defaultValue: 'Choose the provider used for fast, isolated suggestions. Low effort is selected by default to reduce token usage.',
                      })}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative space-y-5 p-4 sm:p-5">
              {settings.isLoading || settings.catalogState.loading ? (
                <div className="flex min-h-24 items-center justify-center gap-2 rounded-xl border border-border bg-background/70 text-sm text-muted-foreground" role="status">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {t('git.generator.loading', { defaultValue: 'Loading generator settings…' })}
                </div>
              ) : settings.loadError || settings.catalogState.error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4" role="alert">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-destructive">
                        {settings.loadError ?? settings.catalogState.error}
                      </p>
                      <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={settings.retryLoad}>
                        {t('git.generator.retry', { defaultValue: 'Retry loading settings' })}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : settings.commitMessage ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="settings-commit-provider" className="mb-2 block text-sm font-medium text-foreground">
                        {t('git.generator.provider', { defaultValue: 'Provider' })}
                      </label>
                      <select
                        id="settings-commit-provider"
                        value={settings.commitMessage.provider}
                        onChange={(event) => settings.changeProvider(event.target.value as LLMProvider)}
                        className={selectClass}
                      >
                        {settings.catalogState.catalog?.providers.map((entry) => (
                          <option key={entry.provider} value={entry.provider} disabled={!entry.available}>
                            {PROVIDER_LABELS[entry.provider]}{entry.available ? '' : ' — unavailable'}
                          </option>
                        ))}
                      </select>
                      {!selectedEntry?.available && selectedEntry?.unavailableReason ? (
                        <p className="mt-1 text-xs text-destructive">{selectedEntry.unavailableReason}</p>
                      ) : null}
                    </div>

                    <div>
                      <label htmlFor="settings-commit-profile" className="mb-2 block text-sm font-medium text-foreground">
                        {t('git.generator.profile', { defaultValue: 'Profile' })}
                      </label>
                      <select
                        id="settings-commit-profile"
                        value={settings.commitMessage.providerProfileId ?? ''}
                        onChange={(event) => settings.changeProfile(event.target.value ? Number(event.target.value) : null)}
                        disabled={!profileRequired}
                        className={selectClass}
                      >
                        {!profileRequired ? (
                          <option value="">{t('git.generator.profileNotRequired', { defaultValue: 'Not required for this provider' })}</option>
                        ) : (
                          <>
                            {selectedEntry?.connectionAvailable ? (
                              <option value="">{t('git.generator.localCli', { defaultValue: 'Local CLI' })}</option>
                            ) : (
                              <option value="" disabled>{t('git.generator.chooseProfile', { defaultValue: 'Choose a profile' })}</option>
                            )}
                            {selectedEntry?.profiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>{profile.title}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="settings-commit-model" className="mb-2 block text-sm font-medium text-foreground">
                        {t('git.generator.model', { defaultValue: 'Model' })}
                      </label>
                      <select
                        id="settings-commit-model"
                        value={settings.commitMessage.model}
                        onChange={(event) => settings.changeModel(event.target.value)}
                        className={selectClass}
                      >
                        <option value="" disabled>{t('git.generator.chooseModel', { defaultValue: 'Choose a model' })}</option>
                        {selectedEntry?.models.OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="settings-commit-effort" className="mb-2 block text-sm font-medium text-foreground">
                        {t('git.generator.effort', { defaultValue: 'Effort' })}
                      </label>
                      <select
                        id="settings-commit-effort"
                        value={settings.commitMessage.effort ?? ''}
                        onChange={(event) => settings.changeEffort(event.target.value || null)}
                        disabled={effortOptions.length === 0}
                        className={selectClass}
                      >
                        {effortOptions.length === 0 ? (
                          <option value="">{t('git.generator.effortUnsupported', { defaultValue: 'Not supported by this model' })}</option>
                        ) : effortOptions.map((effort) => (
                          <option key={effort.value} value={effort.value}>{effort.value}</option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('git.generator.effortHelp', { defaultValue: 'Lower effort is faster and uses fewer provider tokens.' })}
                      </p>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <label htmlFor="settings-commit-base-prompt" className="block text-sm font-medium text-foreground">
                          {t('git.generator.basePrompt', { defaultValue: 'Base prompt' })}
                        </label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t('git.generator.basePromptHelp', { defaultValue: 'Controls style and format only. Fixed safety rules always remain active.' })}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 gap-2"
                        onClick={settings.restoreDefaultBasePrompt}
                        disabled={settings.commitMessage.basePrompt === settings.defaultBasePrompt}
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        {t('git.generator.restoreDefault', { defaultValue: 'Restore default' })}
                      </Button>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-input bg-background shadow-inner focus-within:ring-2 focus-within:ring-ring">
                      <textarea
                        id="settings-commit-base-prompt"
                        value={settings.commitMessage.basePrompt}
                        onChange={(event) => settings.changeBasePrompt(event.target.value)}
                        maxLength={settings.basePromptMaxLength}
                        rows={6}
                        className="w-full resize-y bg-transparent px-3 py-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
                        placeholder={t('git.generator.basePromptPlaceholder', { defaultValue: 'Describe the commit-message style you prefer…' })}
                      />
                      <div className="flex items-center justify-between border-t border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        <span>{t('git.generator.styleOnly', { defaultValue: 'Style-only instruction' })}</span>
                        <span aria-label={t('git.generator.characterCount', { defaultValue: 'Character count' })}>
                          {settings.commitMessage.basePrompt.length}/{settings.basePromptMaxLength}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] p-3 text-sm text-foreground">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <p>
                      {t('git.generator.securityNote', {
                        defaultValue: 'Generation remains isolated and read-only. Staged data is bounded, treated as untrusted, and never creates a visible Chat.',
                      })}
                    </p>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
                  {t('git.generator.noProvider', { defaultValue: 'Connect a provider in Agent Settings, then retry.' })}
                </div>
              )}
            </div>
          </SettingsCard>

          <div className="flex flex-wrap items-start gap-3">
            <Button
              onClick={() => void settings.saveGitConfig()}
              disabled={saveDisabled}
              className="min-h-11"
            >
              {settings.isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : null}
              {settings.isSaving ? t('git.actions.saving') : t('git.actions.save')}
            </Button>

            {settings.saveStatus === 'success' ? (
              <div className="flex min-h-11 items-center gap-2 text-sm text-foreground" role="status">
                <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                {t('git.status.success')}
              </div>
            ) : null}
            {settings.saveStatus === 'error' && settings.saveError ? (
              <div className="flex min-h-11 items-center gap-2 text-sm text-destructive" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {settings.saveError}
              </div>
            ) : null}
          </div>

          {saveDisabled && settings.validationError && !settings.isLoading && !settings.catalogState.loading ? (
            <p className="text-xs text-muted-foreground">{settings.validationError}</p>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  );
}
