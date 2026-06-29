import { create } from 'zustand'

export type SidebarSection = 'workbench' | 'tasks' | 'collections' | 'chat'

const PANEL_WIDTH_KEY = 'project2note-sidebar-panel-width'
const SIDEBAR_SECTION_KEY = 'project2note-sidebar-section'

function readStoredSection(): SidebarSection {
  try {
    const saved = localStorage.getItem(SIDEBAR_SECTION_KEY)
    if (saved === 'workbench' || saved === 'tasks' || saved === 'collections' || saved === 'chat') {
      return saved
    }
  } catch {
    /* ignore */
  }
  return 'workbench'
}

function readStoredWidth(key: string, defaultVal: number, min: number, max: number) {
  try {
    const saved = localStorage.getItem(key)
    if (saved) {
      const n = Number(saved)
      if (!Number.isNaN(n)) return Math.min(max, Math.max(min, n))
    }
  } catch {
    /* ignore */
  }
  return defaultVal
}

interface UIState {
  sidebarSection: SidebarSection
  taskStatusFilter: string
  sidebarPanelWidth: number
  workbenchTaskId: string | null
  setSidebarSection: (section: SidebarSection) => void
  setTaskStatusFilter: (filter: string) => void
  resetTaskListFilters: () => void
  setSidebarPanelWidth: (width: number) => void
  setWorkbenchTaskId: (taskId: string | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarSection: readStoredSection(),
  taskStatusFilter: '',
  sidebarPanelWidth: readStoredWidth(PANEL_WIDTH_KEY, 228, 160, 420),
  workbenchTaskId: null,
  setSidebarSection: (sidebarSection) => {
    localStorage.setItem(SIDEBAR_SECTION_KEY, sidebarSection)
    set({ sidebarSection })
  },
  setTaskStatusFilter: (taskStatusFilter) => set({ taskStatusFilter }),
  resetTaskListFilters: () => set({ taskStatusFilter: '' }),
  setSidebarPanelWidth: (width) => {
    const clamped = Math.min(420, Math.max(160, width))
    localStorage.setItem(PANEL_WIDTH_KEY, String(clamped))
    set({ sidebarPanelWidth: clamped })
  },
  setWorkbenchTaskId: (workbenchTaskId) => set({ workbenchTaskId }),
}))
