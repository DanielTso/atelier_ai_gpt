'use client'

import { memo, useMemo } from 'react'
import { SidebarActionsProvider } from './SidebarActionsContext'
import { CollapsedSidebar } from './CollapsedSidebar'
import { SidebarHeader } from './SidebarHeader'
import { SidebarNav } from './SidebarNav'
import { RecentsSection } from './RecentsSection'
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

  // Flat Recents: all chats (standalone + project) by recency. The page passes
  // chats already newest-first; combine with standaloneChats, de-duped by id.
  const recents = useMemo(() => {
    const byId = new Map<number, Chat>()
    for (const c of [...standaloneChats, ...chats]) byId.set(c.id, c)
    return Array.from(byId.values())
  }, [chats, standaloneChats])

  return (
    <SidebarActionsProvider actions={actions}>
      {collapsed ? (
        <CollapsedSidebar sortedProjects={sortedProjects} />
      ) : (
        <aside className="w-(--sidebar-width) flex flex-col glass-panel rounded-2xl transition-all duration-300 shrink-0 overflow-hidden">
          <SidebarHeader />
          <SidebarNav />
          <div className="h-px bg-border mx-4 my-3" />
          <div className="flex-1 overflow-y-auto px-2">
            <RecentsSection chats={recents} activeChatId={activeChatId} projects={projects} />
          </div>
          <SidebarFooter />
        </aside>
      )}
    </SidebarActionsProvider>
  )
})
