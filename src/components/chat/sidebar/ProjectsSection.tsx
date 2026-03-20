'use client'

import { ChevronDown, Folder, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCollapseState } from '@/hooks/useCollapseState'
import { useSidebarActions } from './SidebarActionsContext'
import { ProjectItem } from './ProjectItem'
import type { Chat, Project } from './types'

interface ProjectsSectionProps {
  sortedProjects: Project[]
  projectChatsMap: Map<number, Chat[]>
  activeProjectId: number | null
  activeChatId: number | null
  projects: Project[]
}

export function ProjectsSection({
  sortedProjects,
  projectChatsMap,
  activeProjectId,
  activeChatId,
  projects,
}: ProjectsSectionProps) {
  const actions = useSidebarActions()
  const { projectsCollapsed, toggleProjects } = useCollapseState()

  return (
    <div>
      <button
        onClick={toggleProjects}
        className="flex items-center gap-2 w-full px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", projectsCollapsed && "-rotate-90")} />
        <Folder className="h-3 w-3 text-purple-400/70" />
        Projects
        {sortedProjects.length > 0 && (
          <span className="ml-auto text-[10px] bg-purple-500/15 text-purple-300 px-1.5 py-0.5 rounded-full">
            {sortedProjects.length}
          </span>
        )}
      </button>

      {!projectsCollapsed && (
        <div className="mt-1 space-y-1 pl-2">
          <button
            onClick={actions.createProject}
            className="flex items-center gap-2 w-full p-2 text-sm text-muted-foreground hover:text-primary transition-colors text-left"
          >
            <Plus className="h-3.5 w-3.5" /> New Project
          </button>

          {sortedProjects.map(p => (
            <ProjectItem
              key={p.id}
              project={p}
              projectChats={projectChatsMap.get(p.id) || []}
              isActive={activeProjectId === p.id}
              activeChatId={activeChatId}
              projects={projects}
            />
          ))}
        </div>
      )}
    </div>
  )
}
