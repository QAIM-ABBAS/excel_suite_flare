import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type ToolView =
  | 'dashboard'
  | 'merge'
  | 'convert'
  | 'duplicates'
  | 'sort'
  | 'filter'
  | 'replace'
  | 'stats'
  | 'pivot'
  | 'validate'
  | 'transpose'
  | 'attendance'
  | 'download-excel'
  | 'download-images'
  | 'settings'
  | 'about'

export type ThemeMode = 'light' | 'dark'

interface FileHistoryItem {
  id: string
  filename: string
  originalName: string
  tool: string
  status: string
  createdAt: string
}

interface NotificationItem {
  id: string
  title: string
  description?: string
  type: 'info' | 'success' | 'warning' | 'error'
  timestamp: number
  read?: boolean
}

interface AppState {
  // Navigation
  currentView: ToolView
  setCurrentView: (view: ToolView) => void

  // Theme
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void

  // File History
  fileHistory: FileHistoryItem[]
  addFileHistory: (item: FileHistoryItem) => void
  clearFileHistory: () => void

  // Global loading
  isLoading: boolean
  setIsLoading: (loading: boolean) => void

  // Active tasks
  activeTasks: number
  incrementActiveTasks: () => void
  decrementActiveTasks: () => void

  // Recently visited tools (for "frequently used" feature on dashboard)
  recentTools: ToolView[]
  trackToolVisit: (view: ToolView) => void
  clearRecentTools: () => void

  // In-app notifications panel
  notifications: NotificationItem[]
  pushNotification: (n: Omit<NotificationItem, 'id' | 'timestamp'>) => void
  markAllRead: () => void
  clearNotifications: () => void
  unreadCount: () => number
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentView: 'dashboard',
      setCurrentView: (view) => {
        set({ currentView: view })
        if (view !== 'dashboard' && view !== 'settings' && view !== 'about') {
          get().trackToolVisit(view)
        }
      },

      theme: 'dark',
      setTheme: (theme) => set({ theme }),

      fileHistory: [],
      addFileHistory: (item) =>
        set((state) => ({ fileHistory: [item, ...state.fileHistory].slice(0, 50) })),
      clearFileHistory: () => set({ fileHistory: [] }),

      isLoading: false,
      setIsLoading: (loading) => set({ isLoading: loading }),

      activeTasks: 0,
      incrementActiveTasks: () => set((state) => ({ activeTasks: state.activeTasks + 1 })),
      decrementActiveTasks: () =>
        set((state) => ({ activeTasks: Math.max(0, state.activeTasks - 1) })),

      recentTools: [],
      trackToolVisit: (view) =>
        set((state) => ({
          recentTools: [
            view,
            ...state.recentTools.filter((t) => t !== view),
          ].slice(0, 6),
        })),
      clearRecentTools: () => set({ recentTools: [] }),

      notifications: [],
      pushNotification: (n) =>
        set((state) => ({
          notifications: [
            {
              ...n,
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              timestamp: Date.now(),
            },
            ...state.notifications,
          ].slice(0, 30),
        })),
      markAllRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
        })),
      clearNotifications: () => set({ notifications: [] }),
      unreadCount: () => get().notifications.filter((n) => !n.read).length,
    }),
    {
      name: 'excel-suite-store',
      storage: createJSONStorage(() => (typeof window !== 'undefined' ? localStorage : (undefined as unknown as Storage))),
      // Only persist recentTools and notifications (and theme fallback), avoid persisting transient nav state
      partialize: (state) => ({
        recentTools: state.recentTools,
        notifications: state.notifications,
        theme: state.theme,
      }),
    }
  )
)
