'use client'

import { memo } from 'react'
import { MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChatContextMenu } from '../ChatContextMenu'
import { useSidebarActions } from './SidebarActionsContext'
import type { Chat, Project } from './types'

interface ChatItemProps {
  chat: Chat
  isActive: boolean
  projects: Project[]
  variant: 'standalone' | 'project' | 'archived'
  currentProjectId?: number | null
}

export const ChatItem = memo(function ChatItem({
  chat,
  isActive,
  projects,
  variant,
  currentProjectId = null,
}: ChatItemProps) {
  const actions = useSidebarActions()

  const handleClick = () => {
    if (variant === 'project') {
      actions.selectChat(chat.id)
    } else {
      actions.selectStandaloneChat(chat.id)
    }
  }

  const isArchived = variant === 'archived'
  const isProjectChat = variant === 'project'

  return (
    <div
      onClick={isProjectChat ? undefined : handleClick}
      className={cn(
        "flex items-center gap-2 cursor-pointer text-sm transition-colors group",
        isProjectChat ? "p-1.5 rounded" : "px-2 py-1.5 rounded-lg",
        isArchived && "opacity-60 hover:opacity-100",
        isActive
          ? cn("text-primary font-medium", isProjectChat ? "bg-primary/5" : "bg-primary/10")
          : cn("text-muted-foreground hover:text-foreground", !isProjectChat && "hover:bg-accent"),
      )}
    >
      {isProjectChat ? (
        <div
          className="flex items-center gap-2 flex-1 truncate"
          onClick={handleClick}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{chat.title}</span>
        </div>
      ) : (
        <>
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate flex-1">{chat.title}</span>
        </>
      )}
      <ChatContextMenu
        chatId={chat.id}
        currentProjectId={currentProjectId ?? chat.projectId}
        projects={projects}
        isArchived={isArchived}
        onMove={actions.moveChat}
        onRename={actions.renameChat}
        onArchive={actions.archiveChat}
        onRestore={actions.restoreChat}
        onDelete={actions.deleteChat}
      />
    </div>
  )
})
