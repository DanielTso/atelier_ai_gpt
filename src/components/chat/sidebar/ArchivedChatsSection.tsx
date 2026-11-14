'use client'

import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { ChatItem } from './ChatItem'
import type { Chat, Project } from './types'

interface ArchivedChatsSectionProps {
  chats: Chat[]
  activeChatId: number | null
  projects: Project[]
}

const isBoolean = (v: unknown) => typeof v === 'boolean'

// Archived chats (project-owned and quick), collapsed by default. Rows open the
// chat under its OWN project via actions.openChat (see ChatItem).
export function ArchivedChatsSection({ chats, activeChatId, projects }: ArchivedChatsSectionProps) {
  // One open-state for the whole section, never per row.
  const [open, setOpen] = useLocalStorage<boolean>('sidebar-archived-open', false, isBoolean)

  if (chats.length === 0) return null

  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:bg-accent hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span>Archived</span>
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground tabular-nums">
          {chats.length}
        </span>
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {chats.map(c => (
            <ChatItem
              key={c.id}
              chat={c}
              isActive={activeChatId === c.id}
              projects={projects}
              variant="archived"
              currentProjectId={c.projectId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
