import type { ComponentType } from 'react';
import {
  Bell,
  Bot,
  GitBranch,
  Info,
  KeyRound,
  ListChecks,
  Mic,
  MonitorPlay,
  Palette,
  Plug,
} from 'lucide-react';

import type {
  AgentCategory,
  AgentProvider,
  CodeEditorSettingsState,
  CursorPermissionsState,
  ProjectSortOrder,
  SettingsMainTab,
} from '../types/types';

export type SettingsMainTabMeta = {
  id: SettingsMainTab;
  group: SettingsGroupId;
  label: string;
  labelKey: string;
  keywords: string;
  icon: ComponentType<{ className?: string }>;
};

export type SettingsGroupId = 'general' | 'ai-integrations' | 'project-tools' | 'system';

export type SettingsGroupMeta = {
  id: SettingsGroupId;
  label: string;
  labelKey: string;
};

export const SETTINGS_GROUPS: SettingsGroupMeta[] = [
  { id: 'general', label: 'General', labelKey: 'settingsGroups.general' },
  { id: 'ai-integrations', label: 'AI & integrations', labelKey: 'settingsGroups.aiIntegrations' },
  { id: 'project-tools', label: 'Project tools', labelKey: 'settingsGroups.projectTools' },
  { id: 'system', label: 'System', labelKey: 'settingsGroups.system' },
];

export const SETTINGS_MAIN_TABS: SettingsMainTabMeta[] = [
  { id: 'appearance', group: 'general', label: 'Appearance', labelKey: 'mainTabs.appearance', keywords: 'appearance theme dark light language', icon: Palette },
  { id: 'notifications', group: 'general', label: 'Notifications', labelKey: 'mainTabs.notifications', keywords: 'notifications alerts push', icon: Bell },
  { id: 'voice', group: 'general', label: 'Voice', labelKey: 'mainTabs.voice', keywords: 'voice microphone speech read aloud', icon: Mic },
  { id: 'agents', group: 'ai-integrations', label: 'Agents', labelKey: 'mainTabs.agents', keywords: 'agents subagents claude code', icon: Bot },
  { id: 'api', group: 'ai-integrations', label: 'API Tokens', labelKey: 'mainTabs.apiTokens', keywords: 'api tokens auth keys', icon: KeyRound },
  { id: 'browser', group: 'ai-integrations', label: 'Browser', labelKey: 'mainTabs.browser', keywords: 'browser playwright chromium automation', icon: MonitorPlay },
  { id: 'plugins', group: 'ai-integrations', label: 'Plugins', labelKey: 'mainTabs.plugins', keywords: 'plugins extensions integrations', icon: Plug },
  { id: 'git', group: 'project-tools', label: 'Git', labelKey: 'mainTabs.git', keywords: 'git github commits', icon: GitBranch },
  { id: 'tasks', group: 'project-tools', label: 'Tasks', labelKey: 'mainTabs.tasks', keywords: 'tasks taskmaster', icon: ListChecks },
  { id: 'about', group: 'system', label: 'About', labelKey: 'mainTabs.about', keywords: 'about version info', icon: Info },
];

export const AGENT_PROVIDERS: AgentProvider[] = ['claude', 'cursor', 'codex', 'opencode'];
export const AGENT_CATEGORIES: AgentCategory[] = ['account', 'permissions', 'mcp'];

export const DEFAULT_PROJECT_SORT_ORDER: ProjectSortOrder = 'name';
export const DEFAULT_SAVE_STATUS = null;
export const DEFAULT_CODE_EDITOR_SETTINGS: CodeEditorSettingsState = {
  wordWrap: false,
  showMinimap: true,
  lineNumbers: true,
  fontSize: '14',
};

export const DEFAULT_CURSOR_PERMISSIONS: CursorPermissionsState = {
  allowedCommands: [],
  disallowedCommands: [],
  skipPermissions: false,
};
