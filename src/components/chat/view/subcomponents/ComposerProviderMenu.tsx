import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { LLMProvider, ProviderSelectionCatalog } from '../../../../types/app';
import { isProfileProvider } from '../../../../shared/hooks/useProviderSelectionCatalog';
import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';

import {
  ComposerMenuItem,
  ComposerMenuSurface,
} from './ComposerMenuPrimitives';

interface ComposerProviderMenuProps {
  currentProvider: LLMProvider;
  currentProfileId: number | null;
  onSelectProvider: (provider: LLMProvider, profileId: number | null) => void;
  /** Disables the trigger while a provider-switch fork is in flight. */
  disabled?: boolean;
  catalog: ProviderSelectionCatalog | null;
  loading: boolean;
  error: string | null;
}

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

export default function ComposerProviderMenu({
  currentProvider,
  currentProfileId,
  onSelectProvider,
  disabled = false,
  catalog,
  loading,
  error,
}: ComposerProviderMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close);
  const availableEntries = (catalog?.providers ?? []).filter((entry) => entry.available);
  const currentEntry = useMemo(
    () => catalog?.providers.find((entry) => entry.provider === currentProvider) ?? null,
    [catalog, currentProvider],
  );

  const triggerLabel = useMemo(() => {
    const brandLabel = PROVIDER_LABELS[currentProvider];
    if (!isProfileProvider(currentProvider)) {
      return brandLabel;
    }
    const profile = currentEntry?.profiles.find((entry) => entry.id === currentProfileId);
    return profile ? `${brandLabel} · ${profile.title}` : brandLabel;
  }, [currentProvider, currentEntry, currentProfileId]);

  // Count of distinct selectable targets (a profile provider contributes one
  // row per active profile; connection providers contribute one row).
  const selectableOptions = useMemo(
    () => availableEntries.reduce(
      (count, entry) => count + (isProfileProvider(entry.provider) ? entry.profiles.length : 1),
      0,
    ),
    [availableEntries],
  );

  if (loading && !catalog) {
    return (
      <button
        type="button"
        disabled
        className="flex h-11 shrink-0 items-center gap-1 bg-transparent px-2 text-sm font-medium text-muted-foreground"
      >
        {t('composer.providerMenuLoading', { defaultValue: 'Loading providers…' })}
      </button>
    );
  }

  if (error && !catalog) {
    return (
      <button
        type="button"
        disabled
        title={error}
        className="flex h-11 shrink-0 items-center gap-1 bg-transparent px-2 text-sm font-medium text-muted-foreground"
      >
        {t('composer.providerMenuError', { defaultValue: 'Providers unavailable' })}
      </button>
    );
  }

  if (selectableOptions === 0) {
    return null;
  }

  const ariaLabel = t('composer.providerMenu', {
    defaultValue: 'Select provider',
  });

  const handlePick = (provider: LLMProvider, profileId: number | null) => {
    if (provider === currentProvider && profileId === currentProfileId) {
      setIsOpen(false);
      return;
    }
    onSelectProvider(provider, profileId);
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="flex h-11 max-w-24 shrink-0 items-center gap-1 bg-transparent px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50 sm:max-w-56"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="truncate">{triggerLabel}</span>
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={ariaLabel}>
          {(catalog?.providers ?? []).map((entry) => {
            const providerLabel = PROVIDER_LABELS[entry.provider];

            if (!entry.available) {
              return (
                <ComposerMenuItem
                  key={entry.provider}
                  label={providerLabel}
                  description={entry.unavailableReason ?? t('composer.providerConfigureSettings', {
                    defaultValue: 'Configure this provider in Settings.',
                  })}
                  disabled
                  isSelected={false}
                  onSelect={() => undefined}
                />
              );
            }

            if (!isProfileProvider(entry.provider)) {
              return (
                <ComposerMenuItem
                  key={entry.provider}
                  label={providerLabel}
                  isSelected={entry.provider === currentProvider && currentProfileId === null}
                  onSelect={() => handlePick(entry.provider, null)}
                />
              );
            }

            return entry.profiles.map((profile) => (
              <ComposerMenuItem
                key={`${entry.provider}-${profile.id}`}
                label={`${providerLabel} · ${profile.title}`}
                isSelected={
                  entry.provider === currentProvider && currentProfileId === profile.id
                }
                onSelect={() => handlePick(entry.provider, profile.id)}
              />
            ));
          })}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}
