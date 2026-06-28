'use client'

import { useState, useRef, useEffect } from 'react'
import { Folder, Plus, ChevronDown, Pencil, Check, X, SlidersHorizontal, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCollapseState } from '@/hooks/useCollapseState'
import { useSidebarActions } from './SidebarActionsContext'
import { ChatItem } from './ChatItem'
import type { Chat, Project } from './types'

interface ProjectItemProps {
  project: Project
  projectChats: Chat[]
  isActive: boolean
  activeChatId: number | null
  projects: Project[]
}

export function ProjectItem({ project, projectChats, isActive, activeChatId, projects }: ProjectItemProps) {
  const actions = useSidebarActions()
  const { toggleProjectChats, isProjectCollapsed } = useCollapseState()
  const collapsed = isProjectCollapsed(project.id)

  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const startEditing = () => {
    setIsEditing(true)
    setEditedName(project.name)
  }

  const saveName = () => {
    if (editedName.trim()) {
      actions.renameProject(project.id, editedName.trim())
    }
    setIsEditing(false)
  }

  const cancelEditing = () => {
    setIsEditing(false)
    setEditedName("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveName()
    else if (e.key === 'Escape') cancelEditing()
  }

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors group",
          isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent"
        )}
      >
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1" onClick={(e) => e.stopPropagation()}>
            <Folder className="h-4 w-4 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={saveName}
              className="flex-1 bg-accent border border-primary/50 rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary min-w-0"
              maxLength={30}
            />
            <button onClick={saveName} className="p-0.5 hover:bg-accent rounded transition-colors">
              <Check className="h-3 w-3 text-green-400" />
            </button>
            <button onClick={cancelEditing} className="p-0.5 hover:bg-accent rounded transition-colors">
              <X className="h-3 w-3 text-red-400" />
            </button>
          </div>
        ) : (
          <>
            <div
              className="flex items-center gap-2 flex-1 min-w-0"
              onClick={() => actions.selectProject(project.id)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleProjectChats(project.id)
                }}
                className="hover:bg-accent rounded p-0.5 transition-colors"
              >
                <ChevronDown className={cn("h-3 w-3 transition-transform", collapsed && "-rotate-90")} />
              </button>
              <Folder className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium truncate">{project.name}</span>
              {projectChats.length > 0 && (
                <span className="text-[10px] bg-purple-500/15 text-purple-300 px-1.5 py-0.5 rounded-full shrink-0">
                  {projectChats.length}
                </span>
              )}
            </div>
            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
              {actions.openProjectDocuments && (
                <button
                  onClick={(e) => { e.stopPropagation(); actions.openProjectDocuments!(project.id) }}
                  className="p-1 hover:text-emerald-400"
                  title="Project documents"
                >
                  <FileText className="h-3 w-3" />
                </button>
              )}
              {actions.openProjectSettings && (
                <button
                  onClick={(e) => { e.stopPropagation(); actions.openProjectSettings!(project.id) }}
                  className="p-1 hover:text-blue-400"
                  title="Project defaults"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); startEditing() }}
                className="p-1 hover:text-primary"
                title="Rename project"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); actions.deleteProject(project.id) }}
                className="p-1 hover:text-red-400"
                title="Delete project"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="ml-4 pl-2 border-l border-border space-y-1">
          <button
            onClick={() => {
              actions.selectProject(project.id)
              actions.createChat()
            }}
            className="flex items-center gap-2 w-full p-1.5 text-sm text-muted-foreground hover:text-primary transition-colors text-left"
          >
            <Plus className="h-3.5 w-3.5" /> New Chat
          </button>
          {projectChats.map(c => (
            <ChatItem
              key={c.id}
              chat={c}
              isActive={activeChatId === c.id}
              projects={projects}
              variant="project"
              currentProjectId={project.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
