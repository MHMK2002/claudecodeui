import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Edit2, Eye, EyeOff, KeyRound, Plus, Star, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../../../../../utils/api';
import { invalidateProviderAuthStatusCache } from '../../../../../../provider-auth/providerAuthStatusCache';
import { Badge, Button, Input } from '../../../../../../../shared/view/ui';
import type {
  ProviderProfileAuthType,
  ProviderProfileProvider,
  ProviderProfilePublic,
} from '../../../../../../../types/app';

type ClaudeProfilesApiResponse = {
  success?: boolean;
  data?: {
    profile?: ProviderProfilePublic;
    profiles?: ProviderProfilePublic[];
  };
  error?: string | {
    message?: string;
  };
};

type ProfileDraft = {
  title: string;
  baseUrl: string;
  token: string;
  authType: ProviderProfileAuthType;
  isDefault: boolean;
  isActive: boolean;
};

type ProviderProfilesProps = {
  provider: ProviderProfileProvider;
  displayName: string;
};

const emptyDraft = (provider: ProviderProfileProvider): ProfileDraft => ({
  title: '',
  baseUrl: '',
  token: '',
  authType: provider === 'codex' ? 'api_key' : 'auth_token',
  isDefault: false,
  isActive: true,
});

function notifyProfilesUpdated(provider: ProviderProfileProvider) {
  invalidateProviderAuthStatusCache(provider);
  window.dispatchEvent(new CustomEvent(`${provider}-provider-profiles-updated`));
  window.dispatchEvent(new CustomEvent('provider-profiles-updated', {
    detail: { provider },
  }));
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null) as ClaudeProfilesApiResponse | null;
  if (typeof payload?.error === 'string') {
    return payload.error;
  }
  return payload?.error?.message || fallback;
}

export default function ProviderProfiles({ provider, displayName }: ProviderProfilesProps) {
  const { t } = useTranslation('settings');
  const isCodex = provider === 'codex';
  const [profiles, setProfiles] = useState<ProviderProfilePublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showCreateToken, setShowCreateToken] = useState(false);
  const [createDraft, setCreateDraft] = useState<ProfileDraft>(() => emptyDraft(provider));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ProfileDraft>(() => emptyDraft(provider));
  const [showEditToken, setShowEditToken] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeProfilesCount = useMemo(
    () => profiles.filter((profile) => profile.isActive).length,
    [profiles],
  );

  const fetchProfiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await authenticatedFetch(`/api/providers/${provider}/profiles`);
      if (!response.ok) {
        throw new Error(await readApiError(response, `Failed to load ${displayName} profiles.`));
      }
      const body = (await response.json()) as ClaudeProfilesApiResponse;
      setProfiles(body.data?.profiles ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : `Failed to load ${displayName} profiles.`);
    } finally {
      setLoading(false);
    }
  }, [displayName, provider]);

  useEffect(() => {
    void fetchProfiles();
  }, [fetchProfiles]);

  useEffect(() => {
    setProfiles([]);
    setError(null);
    setShowCreateForm(false);
    setShowCreateToken(false);
    setCreateDraft(emptyDraft(provider));
    setEditingId(null);
    setEditDraft(emptyDraft(provider));
    setShowEditToken(false);
  }, [provider]);

  const saveProfile = useCallback(async (
    method: 'POST' | 'PATCH',
    draft: ProfileDraft,
    profileId?: number,
  ) => {
    try {
      setSaving(true);
      setError(null);
      const response = await authenticatedFetch(
        profileId
          ? `/api/providers/${provider}/profiles/${profileId}`
          : `/api/providers/${provider}/profiles`,
        {
          method,
          body: JSON.stringify({
            title: draft.title,
            baseUrl: draft.baseUrl,
            token: draft.token,
            authType: draft.authType,
            isDefault: draft.isDefault,
            isActive: draft.isActive,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response, `Failed to save ${displayName} profile.`));
      }

      await fetchProfiles();
      notifyProfilesUpdated(provider);
      setShowCreateForm(false);
      setCreateDraft(emptyDraft(provider));
      setEditingId(null);
      setEditDraft(emptyDraft(provider));
      setShowCreateToken(false);
      setShowEditToken(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : `Failed to save ${displayName} profile.`);
    } finally {
      setSaving(false);
    }
  }, [displayName, fetchProfiles, provider]);

  const patchProfile = useCallback(async (
    profileId: number,
    payload: Partial<ProfileDraft>,
  ) => {
    try {
      setSaving(true);
      setError(null);
      const response = await authenticatedFetch(`/api/providers/${provider}/profiles/${profileId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, `Failed to update ${displayName} profile.`));
      }
      await fetchProfiles();
      notifyProfilesUpdated(provider);
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : `Failed to update ${displayName} profile.`);
    } finally {
      setSaving(false);
    }
  }, [displayName, fetchProfiles, provider]);

  const deleteProfile = useCallback(async (profile: ProviderProfilePublic) => {
    if (!window.confirm(t('agents.providerProfiles.confirmDelete', {
      title: profile.title,
      defaultValue: `Delete "${profile.title}"?`,
    }))) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const response = await authenticatedFetch(`/api/providers/${provider}/profiles/${profile.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, `Failed to delete ${displayName} profile.`));
      }
      await fetchProfiles();
      notifyProfilesUpdated(provider);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : `Failed to delete ${displayName} profile.`);
    } finally {
      setSaving(false);
    }
  }, [displayName, fetchProfiles, provider, t]);

  const startEdit = useCallback((profile: ProviderProfilePublic) => {
    setEditingId(profile.id);
    setShowEditToken(false);
    setEditDraft({
      title: profile.title,
      baseUrl: profile.baseUrl ?? '',
      token: '',
      authType: profile.authType,
      isDefault: profile.isDefault,
      isActive: profile.isActive,
    });
  }, []);

  const renderDraftForm = (
    draft: ProfileDraft,
    setDraft: (draft: ProfileDraft) => void,
    options: {
      mode: 'create' | 'edit';
      showToken: boolean;
      onShowTokenChange: (value: boolean) => void;
      onSubmit: () => void;
      onCancel: () => void;
    },
  ) => {
    const isCreate = options.mode === 'create';
    const canSubmit = draft.title.trim().length > 0
      && (!isCreate || draft.token.trim().length > 0)
      && (!isCodex || draft.baseUrl.trim().length > 0);

    return (
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className={isCodex ? 'grid gap-3' : 'grid gap-3 md:grid-cols-2'}>
          <Input
            placeholder={t('agents.providerProfiles.form.title', { defaultValue: 'Title' })}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
          {!isCodex && (
            <select
              value={draft.authType}
              onChange={(event) => setDraft({
                ...draft,
                authType: event.target.value as ProviderProfileAuthType,
              })}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="auth_token">
                {t('agents.providerProfiles.form.authToken', { defaultValue: 'Auth token / gateway' })}
              </option>
              <option value="api_key">
                {t('agents.providerProfiles.form.apiKey', { defaultValue: 'API key / Anthropic' })}
              </option>
            </select>
          )}
        </div>

        <Input
          placeholder={t('agents.providerProfiles.form.baseUrl', {
            defaultValue: isCodex
              ? 'Base URL, e.g. https://openrouter.ai/api/v1'
              : 'Base URL, e.g. https://openrouter.ai/api/anthropic',
          })}
          value={draft.baseUrl}
          onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
        />

        <div className="relative">
          <Input
            type={options.showToken ? 'text' : 'password'}
            placeholder={isCreate
              ? t('agents.providerProfiles.form.token', { defaultValue: 'Token' })
              : t('agents.providerProfiles.form.rotateToken', { defaultValue: 'New token (leave empty to keep)' })}
            value={draft.token}
            onChange={(event) => setDraft({ ...draft, token: event.target.value })}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => options.onShowTokenChange(!options.showToken)}
            aria-label={options.showToken ? 'Hide token' : 'Show token'}
            className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
          >
            {options.showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={draft.isDefault}
              onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })}
            />
            {t('agents.providerProfiles.form.default', { defaultValue: 'Default' })}
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
            />
            {t('agents.providerProfiles.form.active', { defaultValue: 'Active' })}
          </label>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={options.onSubmit} disabled={!canSubmit || saving}>
            <Check className="mr-1 h-4 w-4" />
            {isCreate
              ? t('agents.providerProfiles.form.add', { defaultValue: 'Add profile' })
              : t('agents.providerProfiles.form.save', { defaultValue: 'Save' })}
          </Button>
          <Button size="sm" variant="outline" onClick={options.onCancel} disabled={saving}>
            <X className="mr-1 h-4 w-4" />
            {t('agents.providerProfiles.form.cancel', { defaultValue: 'Cancel' })}
          </Button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        {t('agents.providerProfiles.loading', { defaultValue: 'Loading provider profiles...' })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <div>
            <h4 className="font-medium text-foreground">
              {t('agents.providerProfiles.title', { defaultValue: 'Provider profiles' })}
            </h4>
            <p className="text-xs text-muted-foreground">
              {t('agents.providerProfiles.subtitle', {
                count: activeProfilesCount,
                provider: displayName,
                defaultValue: '{{count}} active {{provider}} provider profiles',
              })}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowCreateForm((value) => !value)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('agents.providerProfiles.add', { defaultValue: 'Add' })}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {showCreateForm && renderDraftForm(createDraft, setCreateDraft, {
        mode: 'create',
        showToken: showCreateToken,
        onShowTokenChange: setShowCreateToken,
        onSubmit: () => saveProfile('POST', createDraft),
        onCancel: () => {
          setShowCreateForm(false);
          setCreateDraft(emptyDraft(provider));
          setShowCreateToken(false);
        },
      })}

      <div className="space-y-2">
        {profiles.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t('agents.providerProfiles.empty', {
              provider: displayName,
              defaultValue: 'No {{provider}} provider profiles yet.',
            })}
          </div>
        ) : profiles.map((profile) => (
          <div key={profile.id} className="rounded-lg border bg-card p-3">
            {editingId === profile.id ? (
              renderDraftForm(editDraft, setEditDraft, {
                mode: 'edit',
                showToken: showEditToken,
                onShowTokenChange: setShowEditToken,
                onSubmit: () => saveProfile('PATCH', editDraft, profile.id),
                onCancel: () => {
                  setEditingId(null);
                  setEditDraft(emptyDraft(provider));
                  setShowEditToken(false);
                },
              })
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{profile.title}</span>
                    {profile.isDefault && (
                      <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                        {t('agents.providerProfiles.default', { defaultValue: 'Default' })}
                      </Badge>
                    )}
                    <Badge variant="secondary" className={profile.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : ''}>
                      {profile.isActive
                        ? t('agents.providerProfiles.active', { defaultValue: 'Active' })
                        : t('agents.providerProfiles.inactive', { defaultValue: 'Inactive' })}
                    </Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {profile.baseUrl || t('agents.providerProfiles.localEndpoint', {
                      provider: displayName,
                      defaultValue: '{{provider}} default endpoint',
                    })}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {profile.authType === 'api_key'
                      ? t('agents.providerProfiles.apiKey', { defaultValue: 'API key' })
                      : t('agents.providerProfiles.authToken', { defaultValue: 'Auth token' })}
                    {' · '}
                    {profile.hasSecret
                      ? t('agents.providerProfiles.secretSet', { defaultValue: 'Secret set' })
                      : t('agents.providerProfiles.secretMissing', { defaultValue: 'Secret missing' })}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {!profile.isDefault && (
                    <Button
                      size="icon"
                      variant="ghost"
                      title={t('agents.providerProfiles.makeDefault', { defaultValue: 'Make default' })}
                      onClick={() => patchProfile(profile.id, { isDefault: true })}
                      disabled={saving}
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={profile.isActive ? 'outline' : 'secondary'}
                    onClick={() => patchProfile(profile.id, { isActive: !profile.isActive })}
                    disabled={saving}
                  >
                    {profile.isActive
                      ? t('agents.providerProfiles.disable', { defaultValue: 'Disable' })
                      : t('agents.providerProfiles.enable', { defaultValue: 'Enable' })}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => startEdit(profile)} disabled={saving}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteProfile(profile)} disabled={saving}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
