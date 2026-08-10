/**
 * RightSidebar — collapsible right-side panel with two tabs:
 *   - Scheduled Runs
 *   - Quick Settings
 *
 * Visibility (`rightSidebarVisible`) and active tab
 * (`rightSidebarTabQuickSettings` boolean) are persisted via `useUiPreferences`
 * so the panel restores to its previous state on reload.
 *
 * The right sidebar never covers the main content at lg+ — the only overlay
 * backdrop is shown at lg- where horizontal space is tight.
 */

import { useCallback } from 'react';
import { X, PanelRightClose, PanelRightOpen, Clock, Settings2 } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { ScheduledRunsTab } from './ScheduledRunsTab';
import { QuickSettingsTab } from './QuickSettingsTab';

type Tab = 'scheduledRuns' | 'quickSettings';

const PANEL_WIDTH_CLASS = 'w-[340px]';

export function RightSidebar() {
  const { preferences, setPreference } = useUiPreferences();
  const visible = preferences.rightSidebarVisible;
  const activeTab: Tab = preferences.rightSidebarTabQuickSettings ? 'quickSettings' : 'scheduledRuns';

  const toggleVisible = useCallback(() => {
    setPreference('rightSidebarVisible', !visible);
  }, [preferences.rightSidebarVisible, setPreference]);

  const close = useCallback(() => {
    setPreference('rightSidebarVisible', false);
  }, [setPreference]);

  const setTab = useCallback(
    (tab: Tab) => {
      setPreference('rightSidebarTabQuickSettings', tab === 'quickSettings');
    },
    [setPreference],
  );

  return (
    <>
      {!visible && (
        <button
          type="button"
          onClick={toggleVisible}
          aria-label="Open right sidebar"
          className={cn(
            'fixed right-3 top-3 z-30 inline-flex h-9 w-9 items-center justify-center',
            'rounded-md border border-border/60 bg-background/80 text-muted-foreground shadow-sm backdrop-blur',
            'transition-colors hover:text-foreground',
          )}
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      )}

      {visible && (
        <div
          className={cn(
            'fixed right-0 top-0 z-40 h-full bg-background border-l border-border shadow-xl',
            'transition-transform duration-150 ease-out',
            PANEL_WIDTH_CLASS,
          )}
          role="complementary"
          aria-label="Right sidebar"
        >
          <div className="flex h-full flex-col">
            <header
              className={cn(
                'flex items-center justify-between border-b border-border/60',
                'px-4 py-3',
              )}
            >
              <h2 className="text-sm font-semibold text-foreground">Right Sidebar</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleVisible}
                  aria-label="Collapse right sidebar"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                >
                  <PanelRightClose className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close right sidebar"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <nav
              role="tablist"
              aria-label="Right sidebar tabs"
              className="flex shrink-0 border-b border-border/60 bg-background/50 px-2 pt-2"
            >
              <TabButton
                id="scheduled-runs-tab"
                isActive={activeTab === 'scheduledRuns'}
                onClick={() => setTab('scheduledRuns')}
                label="Scheduled Runs"
                icon={<Clock className="h-3.5 w-3.5" />}
              />
              <TabButton
                id="quick-settings-tab"
                isActive={activeTab === 'quickSettings'}
                onClick={() => setTab('quickSettings')}
                label="Quick Settings"
                icon={<Settings2 className="h-3.5 w-3.5" />}
              />
            </nav>

            <div className="flex-1 overflow-y-auto" role="tabpanel">
              {activeTab === 'scheduledRuns' ? <ScheduledRunsTab /> : <QuickSettingsTab />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type TabButtonProps = {
  id: string;
  isActive: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
};

function TabButton({ id, isActive, onClick, label, icon }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-medium',
        'border-b-2 transition-colors',
        isActive
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}