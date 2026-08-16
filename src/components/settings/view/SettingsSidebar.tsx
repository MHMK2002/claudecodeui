import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import { SETTINGS_GROUPS, SETTINGS_MAIN_TABS } from '../constants/constants';
import type { SettingsMainTab } from '../types/types';

type SettingsSidebarProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
};

export default function SettingsSidebar({ activeTab, onChange }: SettingsSidebarProps) {
  const { t } = useTranslation('settings');

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-60 flex-shrink-0 border-r border-border bg-muted/30 md:flex md:flex-col">
        <nav aria-label={t('mainTabs.label')} className="flex flex-col gap-5 overflow-y-auto p-3">
          {SETTINGS_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`settings-group-${group.id}`}>
              <h3
                id={`settings-group-${group.id}`}
                className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t(group.labelKey, { defaultValue: group.label })}
              </h3>
              <div className="space-y-1">
                {SETTINGS_MAIN_TABS.filter((item) => item.group === group.id).map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => onChange(item.id)}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isActive
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground active:bg-accent/50',
                      )}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                      {t(item.labelKey, { defaultValue: item.label })}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
      </aside>

      {/* A grouped native picker stays recoverable at the required 320 px width. */}
      <div className="flex-shrink-0 border-b border-border p-3 md:hidden">
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted-foreground">
            {t('mainTabs.label')}
          </span>
          <select
            className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={activeTab}
            onChange={(event) => onChange(event.target.value as SettingsMainTab)}
          >
            {SETTINGS_GROUPS.map((group) => (
              <optgroup
                key={group.id}
                label={t(group.labelKey, { defaultValue: group.label })}
              >
                {SETTINGS_MAIN_TABS.filter((item) => item.group === group.id).map((item) => (
                  <option key={item.id} value={item.id}>
                    {t(item.labelKey, { defaultValue: item.label })}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
