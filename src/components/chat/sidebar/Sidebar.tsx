'use client'

import { memo, useMemo } from 'react'
import { SidebarActionsProvider } from './SidebarActionsContext'
import { CollapsedSidebar } from './CollapsedSidebar'
import { SidebarHeader } from './SidebarHeader'
import { SmartChatMenu } from './SmartChatMenu'
import { QuickChatsSection } from './QuickChatsSection'
import { ProjectsSection } from './ProjectsSection'
import { ArchivedSection } from './ArchivedSection'
import { SidebarFooter } from './SidebarFooter'
import type { SidebarActions, Project, Chat } from './types'

export interface SidebarProps {
  projects: Project[]
  activeProjectId: number | null
  chats: Chat[]
  activeChatId: number | null
  standaloneChats: Chat[]
  archivedChats: Chat[]
  collapsed: boolean
  actions: SidebarActions
}

export const Sidebar = memo(function Sidebar({
  projects,
  activeProjectId,
  chats,
  activeChatId,
  standaloneChats,
  archivedChats,
  collapsed,
  actions,
}: SidebarProps) {
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  )

  const projectChatsMap = useMemo(() => {
    const map = new Map<number, Chat[]>()
    for (const chat of chats) {
      if (chat.projectId !== null) {
        const existing = map.get(chat.projectId) || []
        existing.push(chat)
        map.set(chat.projectId, existing)
      }
    }
    return map
  }, [chats])

  return (
    <SidebarActionsProvider actions={actions}>
      {collapsed ? (
        <CollapsedSidebar sortedProjects={sortedProjects} />
      ) : (
        <aside className="w-72 flex flex-col glass-panel rounded-2xl transition-all duration-300 shrink-0 overflow-hidden">
          <SidebarHeader />
          <SmartChatMenu sortedProjects={sortedProjects} variant="expanded" />

          <div className="flex-1 overflow-y-auto space-y-4 px-4">
            <QuickChatsSection
              standaloneChats={standaloneChats}
              activeChatId={activeChatId}
              projects={projects}
            />

            <div className="h-px bg-border" />

            <ProjectsSection
              sortedProjects={sortedProjects}
              projectChatsMap={projectChatsMap}
              activeProjectId={activeProjectId}
              activeChatId={activeChatId}
              projects={projects}
            />

            <ArchivedSection
              archivedChats={archivedChats}
              activeChatId={activeChatId}
              projects={projects}
            />
          </div>

          <SidebarFooter />
        </aside>
      )}
    </SidebarActionsProvider>
  )
})
