import { useCallback, useEffect, useState } from 'react';

import type { ProjectDrawerState, ProjectDrawerTab } from '../types';

const STORAGE_KEY = 'project-drawer-state-v1';
const DEFAULT_WIDTH = 340;
export const PROJECT_DRAWER_MIN_WIDTH = 300;
export const PROJECT_DRAWER_MAX_WIDTH = 520;
const TABS = new Set<ProjectDrawerTab>(['tasks', 'scheduledRuns', 'quickSettings']);

const clampWidth = (value: number) => (
  Math.min(PROJECT_DRAWER_MAX_WIDTH, Math.max(PROJECT_DRAWER_MIN_WIDTH, value))
);

function readState(): ProjectDrawerState {
  const fallback: ProjectDrawerState = { isOpen: false, activeTab: 'tasks', width: DEFAULT_WIDTH };
  if (typeof window === 'undefined') return fallback;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as Partial<ProjectDrawerState>;
    return {
      isOpen: typeof parsed.isOpen === 'boolean' ? parsed.isOpen : fallback.isOpen,
      activeTab: TABS.has(parsed.activeTab as ProjectDrawerTab)
        ? parsed.activeTab as ProjectDrawerTab
        : fallback.activeTab,
      width: typeof parsed.width === 'number' && Number.isFinite(parsed.width)
        ? clampWidth(parsed.width)
        : fallback.width,
    };
  } catch {
    return fallback;
  }
}

/** Owns the canonical persisted open/tab/width state for the project drawer. */
export function useProjectDrawerState() {
  const [state, setState] = useState<ProjectDrawerState>(readState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const setOpen = useCallback((isOpen: boolean) => {
    setState((current) => ({ ...current, isOpen }));
  }, []);
  const setActiveTab = useCallback((activeTab: ProjectDrawerTab) => {
    setState((current) => ({ ...current, activeTab }));
  }, []);
  const setWidth = useCallback((width: number) => {
    setState((current) => ({ ...current, width: clampWidth(width) }));
  }, []);

  return { ...state, setOpen, setActiveTab, setWidth };
}
