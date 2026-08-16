import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { CalendarClock, ListChecks, Settings2 } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ScheduledRun } from '../../../types/scheduledRuns';
import type { TaskWorkflowCallbacks } from '../../task-master/workflow';
import { ScheduledRunsTab } from '../../scheduled-runs/panel/ScheduledRunsTab';
import {
  PROJECT_DRAWER_MAX_WIDTH,
  PROJECT_DRAWER_MIN_WIDTH,
  useProjectDrawerState,
} from '../hooks/useProjectDrawerState';
import { useQuickSettingsDrag } from '../hooks/useQuickSettingsDrag';
import type { PreferenceToggleKey, QuickSettingsPreferences } from '../types';

import QuickSettingsContent from './QuickSettingsContent';
import QuickSettingsHandle from './QuickSettingsHandle';
import TasksDrawerTab from './TasksDrawerTab';

type QuickSettingsPanelViewProps = TaskWorkflowCallbacks & {
  onCreateTask: () => void;
  onCreateSchedule: () => void;
  onEditSchedule: (schedule: ScheduledRun) => void;
  onOpenProviderSettings: () => void;
};

/** Canonical docked project drawer used by Tasks, Schedules, and quick settings. */
export default function QuickSettingsPanelView({
  sendMessage,
  onSessionEstablished,
  onNavigateToSession,
  onSessionProcessing,
  onCreateTask,
  onCreateSchedule,
  onEditSchedule,
  onOpenProviderSettings,
}: QuickSettingsPanelViewProps) {
  const { isOpen, activeTab, width, setOpen, setActiveTab, setWidth } = useProjectDrawerState();
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { isDarkMode } = useTheme();
  const { preferences, setPreference } = useUiPreferences();
  const resizeCleanupRef = useRef<(() => void) | null>(null);
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
    (key: PreferenceToggleKey, value: boolean) => setPreference(key, value),
    [setPreference],
  );

  const handleToggleFromHandle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (consumeSuppressedClick()) {
        event.preventDefault();
        return;
      }
      setOpen(!isOpen);
    },
    [consumeSuppressedClick, isOpen, setOpen],
  );

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (isMobile) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handleMove = (moveEvent: PointerEvent) => {
      setWidth(startWidth + startX - moveEvent.clientX);
    };
    const stop = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stop);
      resizeCleanupRef.current = null;
    };
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = stop;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stop);
  }, [isMobile, setWidth, width]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  return (
    <>
      <QuickSettingsHandle
        isOpen={isOpen}
        isDragging={isDragging}
        drawerWidth={width}
        style={handleStyle}
        onClick={handleToggleFromHandle}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
      />

      <aside
        className={cn(
          'h-full overflow-hidden border-l bg-background transition-[width] duration-150 ease-out',
          isMobile ? 'fixed right-0 top-0 z-40 max-w-[90vw]' : 'relative shrink-0',
          isOpen ? 'visible border-border' : 'invisible w-0 border-transparent',
        )}
        style={{ width: isOpen ? width : 0 }}
        aria-label="Project drawer"
        aria-hidden={!isOpen}
      >
        {isOpen && !isMobile && (
          <div
            role="separator"
            aria-label="Resize project drawer"
            aria-orientation="vertical"
            aria-valuemin={PROJECT_DRAWER_MIN_WIDTH}
            aria-valuemax={PROJECT_DRAWER_MAX_WIDTH}
            aria-valuenow={width}
            aria-valuetext={`${width} pixels`}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setWidth(width + 16);
              if (event.key === 'ArrowRight') setWidth(width - 16);
            }}
            className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}

        <div className="flex h-full flex-col" style={{ width }}>
          <header className="shrink-0 border-b border-border bg-muted/30">
            <div className="px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Project drawer</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Tasks, schedules, and project settings</p>
            </div>

            <nav className="grid grid-cols-3 px-2" role="tablist" aria-label="Project drawer sections">
              <DrawerTabButton active={activeTab === 'tasks'} icon={<ListChecks className="h-4 w-4" />} label="Tasks" onClick={() => setActiveTab('tasks')} />
              <DrawerTabButton active={activeTab === 'scheduledRuns'} icon={<CalendarClock className="h-4 w-4" />} label="Schedules" onClick={() => setActiveTab('scheduledRuns')} />
              <DrawerTabButton active={activeTab === 'quickSettings'} icon={<Settings2 className="h-4 w-4" />} label="Settings" onClick={() => setActiveTab('quickSettings')} />
            </nav>
          </header>

          <div className="min-h-0 flex-1" role="tabpanel" aria-label={`${activeTab} project drawer panel`}>
            {activeTab === 'tasks' && (
              <TasksDrawerTab
                sendMessage={sendMessage}
                onSessionEstablished={onSessionEstablished}
                onNavigateToSession={onNavigateToSession}
                onSessionProcessing={onSessionProcessing}
                onCreateTask={onCreateTask}
              />
            )}
            {activeTab === 'scheduledRuns' && (
              <ScheduledRunsTab
                onCreate={onCreateSchedule}
                onEdit={onEditSchedule}
                onOpenAgentSettings={onOpenProviderSettings}
              />
            )}
            {activeTab === 'quickSettings' && (
              <div className="flex h-full flex-col">
                <QuickSettingsContent
                  isDarkMode={isDarkMode}
                  preferences={quickSettingsPreferences}
                  onPreferenceChange={handlePreferenceChange}
                />
                <div className="border-t border-border p-3">
                  <button
                    type="button"
                    onClick={onOpenProviderSettings}
                    className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Open Agent Settings
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

type DrawerTabButtonProps = {
  active: boolean;
  icon: ReactNode;
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
        'inline-flex min-h-11 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
