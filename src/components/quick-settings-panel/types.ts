import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

export type PreferenceToggleKey =
  | 'showRawParameters'
  | 'showThinking'
  | 'sendByCtrlEnter'
  | 'voiceEnabled';

export type QuickSettingsPreferences = Record<PreferenceToggleKey, boolean>;

export type PreferenceToggleItem = {
  key: PreferenceToggleKey;
  labelKey: string;
  icon: LucideIcon;
};

export type QuickSettingsHandleStyle = CSSProperties;

export type ProjectDrawerTab = 'tasks' | 'scheduledRuns' | 'quickSettings';

export type ProjectDrawerState = {
  isOpen: boolean;
  activeTab: ProjectDrawerTab;
  width: number;
};
