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
  // Project actions
  createProject: () => void
  renameProject: (id: number, name: string) => void
  deleteProject: (id: number) => void
  selectProject: (id: number) => void
  openProjectDocuments?: (projectId: number) => void
  openProjectSettings?: (projectId: number) => void
  // Chat actions
  createChat: () => void
  createStandaloneChat: () => void
  createChatInProject: (projectId: number) => void
  selectChat: (id: number) => void
  selectStandaloneChat: (id: number) => void
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
