"use client"

import { memo, useState, useRef, useEffect } from "react"
import { MessageSquare, Edit2, Check, X, Folder, ChevronRight, Zap, MoreVertical, SlidersHorizontal } from "lucide-react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"

interface ChatHeaderProps {
  chatId: number | null
  chatTitle: string | undefined
  onTitleChange?: (id: number, title: string) => void
  /** The chat's OWN project (null for a quick chat). */
  projectId?: number | null
  projectName?: string | null
  onProjectClick?: () => void
  /** Opens the per-project defaults dialog — offered on project chats only. */
  onOpenProjectSettings?: (projectId: number) => void
}

export const ChatHeader = memo(function ChatHeader({
  chatId,
  chatTitle,
  onTitleChange,
  projectId,
  projectName,
  onProjectClick,
  onOpenProjectSettings,
}: ChatHeaderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedTitle, setEditedTitle] = useState(chatTitle || "")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Sync local edit state when prop changes (valid draft-state pattern)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditedTitle(chatTitle || "")
  }, [chatTitle])

  const handleSave = () => {
    if (chatId && editedTitle.trim() && onTitleChange) {
      onTitleChange(chatId, editedTitle.trim())
    }
    setIsEditing(false)
  }

  const handleCancel = () => {
    setEditedTitle(chatTitle || "")
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  return (
    <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-muted">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Breadcrumb root: project (clickable) or quick-chat marker */}
        {chatId && (
          projectName ? (
            <button
              onClick={onProjectClick}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0 min-w-0 max-w-[40%]"
              title={`Go to project ${projectName}`}
            >
              <Folder className="h-4 w-4 shrink-0" />
              <span className="truncate">{projectName}</span>
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0" title="Quick chat (not in a project)">
              <Zap className="h-4 w-4 shrink-0" />
              <span>Quick chat</span>
            </span>
          )
        )}
        {chatId && <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />}
        {!chatId && <MessageSquare className="h-5 w-5 text-primary shrink-0" />}
        {isEditing && chatId ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              ref={inputRef}
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-background border border-primary/50 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              maxLength={50}
            />
            <button
              onClick={handleSave}
              className="p-1 hover:bg-accent rounded transition-colors"
              title="Save"
            >
              <Check className="h-4 w-4 text-green-400" />
            </button>
            <button
              onClick={handleCancel}
              className="p-1 hover:bg-accent rounded transition-colors"
              title="Cancel"
            >
              <X className="h-4 w-4 text-red-400" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group flex-1 min-w-0">
            <span className="font-medium truncate">
              {chatTitle || "Select a Chat"}
            </span>
            {chatId && onTitleChange && (
              <button
                onClick={() => setIsEditing(true)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-accent rounded transition-all"
                title="Edit chat title"
              >
                <Edit2 className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
        )}
      </div>
      {/* Project chat menu: the chat's project settings (per-project defaults). */}
      {chatId && projectId != null && onOpenProjectSettings && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              aria-label={`Project options for ${projectName ?? 'this project'}`}
              className="ml-2 p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="min-w-[160px] glass-panel rounded-xl p-1.5 shadow-2xl border border-border z-50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-1 duration-150"
            >
              <DropdownMenu.Item
                onClick={() => onOpenProjectSettings(projectId)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-accent outline-none transition-colors"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                Project settings
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </header>
  )
})
