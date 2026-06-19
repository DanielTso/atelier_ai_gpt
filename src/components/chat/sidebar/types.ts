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

export type AppView = 'home' | 'projects' | 'artifacts'

export interface SidebarActions {
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
  moveChat: (chatId: number, projectId: number | null) => void
  renameChat: (chatId: number) => void
  archiveChat: (chatId: number) => void
  restoreChat: (chatId: number) => void
  deleteChat: (chatId: number) => void
  // UI actions
  toggleTheme: () => void
  toggleCollapse: () => void
  openSettings: () => void
  selectView: (view: AppView) => void
  activeView: AppView
}
