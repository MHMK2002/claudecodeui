import { useCallback, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { CalendarClock, ListChecks, Settings2 } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useTheme } from '../../../contexts/ThemeContext';
import type { TaskWorkflowCallbacks } from '../../task-master/workflow';
import { ScheduledRunsTab } from '../../scheduled-runs/panel/ScheduledRunsTab';
import { useQuickSettingsDrag } from '../hooks/useQuickSettingsDrag';
import type { PreferenceToggleKey, QuickSettingsPreferences } from '../types';

import QuickSettingsContent from './QuickSettingsContent';
import QuickSettingsHandle from './QuickSettingsHandle';
import TasksDrawerTab from './TasksDrawerTab';

type DrawerTab = 'tasks' | 'scheduledRuns' | 'quickSettings';

type QuickSettingsPanelViewProps = TaskWorkflowCallbacks;

export default function QuickSettingsPanelView({
  sendMessage,
  onSessionEstablished,
  onNavigateToSession,
  onSessionProcessing,
}: QuickSettingsPanelViewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>('tasks');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { isDarkMode } = useTheme();
  const { preferences, setPreference } = useUiPreferences();
  const {
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  } = useQuickSettingsDrag({ isMobile });

  const quickSettingsPreferences = useMemo<QuickSettingsPreferences>(() => ({
    showRawParameters: preferences.showRawParameters,
    showThinking: preferences.showThinking,
    sendByCtrlEnter: preferences.sendByCtrlEnter,
    voiceEnabled: preferences.voiceEnabled,
  }), [
    preferences.sendByCtrlEnter,
    preferences.showRawParameters,
    preferences.showThinking,
    preferences.voiceEnabled,
  ]);

  const handlePreferenceChange = useCallback(
    (key: PreferenceToggleKey, value: boolean) => {
      setPreference(key, value);
    },
    [setPreference],
  );

  const handleToggleFromHandle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // A drag releases a click event as well; this guard prevents accidental toggles.
      if (consumeSuppressedClick()) {
        event.preventDefault();
        return;
      }

      setIsOpen((previous) => !previous);
    },
    [consumeSuppressedClick],
  );

  return (
    <>
      <QuickSettingsHandle
        isOpen={isOpen}
        isDragging={isDragging}
        style={handleStyle}
        onClick={handleToggleFromHandle}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
      />

      <aside
        className={cn(
          'fixed right-0 top-0 z-40 h-full w-80 transform border-l border-border bg-background shadow-xl',
          'transition-transform duration-150 ease-out',
          isOpen ? 'visible translate-x-0' : 'invisible translate-x-full',
          isMobile && 'h-screen',
        )}
        aria-label="Project drawer"
        aria-hidden={!isOpen}
      >
        <div className="flex h-full flex-col">
          <header className="shrink-0 border-b border-border bg-muted/30">
            <div className="px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Project drawer</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Tasks, schedules, and quick settings
                </p>
              </div>
            </div>

            <nav className="grid grid-cols-3 px-2" role="tablist" aria-label="Project drawer sections">
              <DrawerTabButton
                active={activeTab === 'tasks'}
                icon={<ListChecks className="h-3.5 w-3.5" />}
                label="Tasks"
                onClick={() => setActiveTab('tasks')}
              />
              <DrawerTabButton
                active={activeTab === 'scheduledRuns'}
                icon={<CalendarClock className="h-3.5 w-3.5" />}
                label="Schedules"
                onClick={() => setActiveTab('scheduledRuns')}
              />
              <DrawerTabButton
                active={activeTab === 'quickSettings'}
                icon={<Settings2 className="h-3.5 w-3.5" />}
                label="Settings"
                onClick={() => setActiveTab('quickSettings')}
              />
            </nav>
          </header>

          <div className="min-h-0 flex-1" role="tabpanel">
            {activeTab === 'tasks' && (
              <TasksDrawerTab
                sendMessage={sendMessage}
                onSessionEstablished={onSessionEstablished}
                onNavigateToSession={onNavigateToSession}
                onSessionProcessing={onSessionProcessing}
              />
            )}
            {activeTab === 'scheduledRuns' && <ScheduledRunsTab />}
            {activeTab === 'quickSettings' && (
              <QuickSettingsContent
                isDarkMode={isDarkMode}
                preferences={quickSettingsPreferences}
                onPreferenceChange={handlePreferenceChange}
              />
            )}
          </div>
        </div>
      </aside>

      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm transition-opacity duration-150 ease-out"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}

type DrawerTabButtonProps = {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
};

function DrawerTabButton({ active, icon, label, onClick }: DrawerTabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
