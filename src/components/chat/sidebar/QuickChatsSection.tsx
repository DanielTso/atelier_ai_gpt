'use client'

import { ChevronDown, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCollapseState } from '@/hooks/useCollapseState'
import { ChatItem } from './ChatItem'
import type { Chat, Project } from './types'

interface QuickChatsSectionProps {
  standaloneChats: Chat[]
  activeChatId: number | null
  projects: Project[]
}

export function QuickChatsSection({ standaloneChats, activeChatId, projects }: QuickChatsSectionProps) {
  const { quickChatsCollapsed, toggleQuickChats } = useCollapseState()

  return (
    <div>
      <button
        onClick={toggleQuickChats}
        className="flex items-center gap-2 w-full px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", quickChatsCollapsed && "-rotate-90")} />
        <MessageCircle className="h-3 w-3 text-blue-400/70" />
        Quick Chats
        {standaloneChats.length > 0 && (
          <span className="ml-auto text-[10px] bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded-full">
            {standaloneChats.length}
          </span>
        )}
      </button>

      {!quickChatsCollapsed && (
        <div className="mt-1 space-y-1 pl-2">
          {standaloneChats.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 px-2 py-1">No quick chats yet</p>
          ) : (
            standaloneChats.map(c => (
              <ChatItem
                key={c.id}
                chat={c}
                isActive={activeChatId === c.id}
                projects={projects}
                variant="standalone"
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
