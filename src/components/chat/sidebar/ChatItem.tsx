'use client'

import { memo } from 'react'
import { MessageSquare } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { ChatContextMenu } from '../ChatContextMenu'
import { useSidebarActions } from './SidebarActionsContext'
import type { Chat, Project } from './types'

interface ChatItemProps {
  chat: Chat
  isActive: boolean
  projects: Project[]
  variant: 'standalone' | 'archived'
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

  const isArchived = variant === 'archived'

  // An archived chat may belong to a project: open it under its OWN project.
  const handleClick = () => {
    if (isArchived) {
      actions.openChat(chat.id, chat.projectId)
    } else {
      actions.selectStandaloneChat(chat.id)
    }
  }

  // While the auto-title generates, the placeholder shimmers; the real title
  // then fades in via the keyed span instead of snapping.
  const titlePending = actions.titlePendingIds instanceof Set && actions.titlePendingIds.has(chat.id)
  const titleSpan = (extra?: string) => (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={chat.title}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={cn('truncate', extra, titlePending && 'text-shimmer')}
      >
        {chat.title}
      </motion.span>
    </AnimatePresence>
  )

  return (
    <div
      onClick={handleClick}
      className={cn(
        "flex items-center gap-2 cursor-pointer text-sm transition-colors group px-2 py-1.5 rounded-lg",
        isArchived && "opacity-60 hover:opacity-100",
        isActive
          ? "text-primary font-medium bg-primary/10"
          : "text-muted-foreground hover:text-foreground hover:bg-accent",
      )}
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0" />
      {titleSpan('flex-1')}
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
