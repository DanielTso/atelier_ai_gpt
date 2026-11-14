import type { ChatRowActions } from '@/types'

export interface Project {
  id: number
  name: string
}

export interface Chat {
  id: number
  projectId: number | null
  title: string
  archived?: boolean | null
}

export type AppView = 'home' | 'projects' | 'artifacts' | 'images'

// moveChat/renameChat/archiveChat/deleteChat come from ChatRowActions (shared
// with the project landing page's chat rows).
export interface SidebarActions extends ChatRowActions {
  // Chat actions
  createStandaloneChat: () => void
  createChatInProject: (projectId: number) => void
  selectStandaloneChat: (id: number) => void
  // Opens any chat (project, quick or archived) under its OWN project, from any view
  openChat: (id: number, projectId: number | null) => void
  restoreChat: (chatId: number) => void
  // UI actions
  toggleTheme: () => void
  toggleCollapse: () => void
  openSettings: () => void
  selectView: (view: AppView) => void
  activeView: AppView
  // Chat-title state — ids whose auto-title is generating (sidebar shimmers these)
  titlePendingIds?: Set<number>
}
