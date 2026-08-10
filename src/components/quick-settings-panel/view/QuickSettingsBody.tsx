/**
 * QuickSettingsBody — the body content of the Quick Settings panel,
 * without its own slide animation or backdrop. Used inside the right
 * sidebar tab strip.
 *
 * The component reads from `useUiPreferences` for the four toggles and
 * writes back via `setPreference`. Theme context is consumed for the
 * dark-mode toggle.
 */

import { useCallback, useMemo } from 'react';

import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useTheme } from '../../../contexts/ThemeContext';
import type { PreferenceToggleKey, QuickSettingsPreferences } from '../types';

import QuickSettingsContent from './QuickSettingsContent';
import QuickSettingsPanelHeader from './QuickSettingsPanelHeader';

export default function QuickSettingsBody() {
  const { isDarkMode } = useTheme();
  const { preferences, setPreference } = useUiPreferences();

  const quickSettingsPreferences = useMemo<QuickSettingsPreferences>(
    () => ({
      showRawParameters: preferences.showRawParameters,
      showThinking: preferences.showThinking,
      sendByCtrlEnter: preferences.sendByCtrlEnter,
      voiceEnabled: preferences.voiceEnabled,
    }),
    [
      preferences.sendByCtrlEnter,
      preferences.showRawParameters,
      preferences.showThinking,
      preferences.voiceEnabled,
    ],
  );

  const handlePreferenceChange = useCallback(
    (key: PreferenceToggleKey, value: boolean) => {
      setPreference(key, value);
    },
    [setPreference],
  );

  return (
    <div className="flex h-full flex-col">
      <QuickSettingsPanelHeader />
      <QuickSettingsContent
        isDarkMode={isDarkMode}
        preferences={quickSettingsPreferences}
        onPreferenceChange={handlePreferenceChange}
      />
    </div>
  );
}