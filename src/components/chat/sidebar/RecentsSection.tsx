'use client'

import { ChatItem } from './ChatItem'
import type { Chat, Project } from './types'

interface RecentsSectionProps {
  chats: Chat[]
  activeChatId: number | null
  projects: Project[]
}

export function RecentsSection({ chats, activeChatId, projects }: RecentsSectionProps) {
  return (
    <div>
      <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Recents
      </p>
      <div className="mt-1 space-y-1">
        {chats.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 px-2 py-1">No recent chats yet</p>
        ) : (
          chats.map(c => (
            <ChatItem
              key={c.id}
              chat={c}
              isActive={activeChatId === c.id}
              projects={projects}
              variant={c.projectId === null ? 'standalone' : 'project'}
              currentProjectId={c.projectId}
            />
          ))
        )}
      </div>
    </div>
  )
}
