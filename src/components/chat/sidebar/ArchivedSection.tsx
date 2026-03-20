'use client'

import { ChevronDown, Archive } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCollapseState } from '@/hooks/useCollapseState'
import { ChatItem } from './ChatItem'
import type { Chat, Project } from './types'

interface ArchivedSectionProps {
  archivedChats: Chat[]
  activeChatId: number | null
  projects: Project[]
}

export function ArchivedSection({ archivedChats, activeChatId, projects }: ArchivedSectionProps) {
  const { archivedCollapsed, toggleArchived } = useCollapseState()

  if (archivedChats.length === 0) return null

  return (
    <>
      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div>
        <button
          onClick={toggleArchived}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", archivedCollapsed && "-rotate-90")} />
          <Archive className="h-3 w-3 text-amber-400/70" />
          Archived
          <span className="ml-auto text-[10px] bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded-full">
            {archivedChats.length}
          </span>
        </button>

        {!archivedCollapsed && (
          <div className="mt-1 space-y-1 pl-2">
            {archivedChats.map(c => (
              <ChatItem
                key={c.id}
                chat={c}
                isActive={activeChatId === c.id}
                projects={projects}
                variant="archived"
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
