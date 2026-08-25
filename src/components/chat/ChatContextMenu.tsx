'use client'

import { memo, useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, FolderInput, Pencil, Archive, Trash2, MessageCircle, ArchiveRestore } from 'lucide-react'
import { cn, formatUsd } from '@/lib/utils'
import type { Project } from '@/components/chat/sidebar/types'

interface ChatContextMenuProps {
  chatId: number
  currentProjectId: number | null
  projects: Project[]
  isArchived?: boolean
  onMove: (chatId: number, projectId: number | null) => void
  onRename: (chatId: number) => void
  onArchive: (chatId: number) => void
  onRestore?: (chatId: number) => void
  onDelete: (chatId: number) => void
}

export const ChatContextMenu = memo(function ChatContextMenu({
  chatId,
  currentProjectId,
  projects,
  isArchived = false,
  onMove,
  onRename,
  onArchive,
  onRestore,
  onDelete,
}: ChatContextMenuProps) {
  // Cost is fetched lazily (only when the menu opens), not on every sidebar
  // render — a sidebar can list many chats, and the figure is a nice-to-know,
  // not something worth a query per chat item on every page load.
  //
  // The `@/app/actions` import is dynamic too, but NOT for a production
  // bundle-size reason — importing a 'use server' module from a client
  // component compiles to a small RPC-stub reference either way, so a static
  // import wouldn't have pulled the real server module (DB connection,
  // artifact renderers, etc.) into the client bundle. The real reason is the
  // TEST environment: vitest has no such transform, so it resolves the
  // literal module, and @/db throws at import time when DATABASE_URL is
  // unset. A static import here broke three unrelated jsdom suites
  // (Sidebar/ProjectLandingPage/RecentsSection) that render chat items
  // without mocking @/db — none of them ever open this menu, so the dynamic
  // import means they never touch the module at all. Note UsageSettingsTab.tsx
  // has the identical hazard via a STATIC `@/app/actions` import and is only
  // latent because no test currently renders SettingsDialog; a shared @/db
  // mock in the test setup would remove this class of coupling for both
  // instead of requiring every future call site to remember the workaround.
  const [cost, setCost] = useState<{ costUsd: number; estimated: boolean } | null>(null)
  const unmountedRef = useRef(false)
  useEffect(() => {
    return () => { unmountedRef.current = true }
  }, [])

  const handleOpenChange = (open: boolean) => {
    if (!open) return
    import('@/app/actions')
      .then(({ getChatCost }) => getChatCost(chatId))
      .then(result => { if (!unmountedRef.current) setCost(result) })
      .catch(err => {
        console.error('[ChatContextMenu] failed to load chat cost', err)
        if (!unmountedRef.current) setCost(null)
      })
  }

  // Hidden when zero or unknown (fetch hasn't resolved, or errored).
  const costLabel = cost && cost.costUsd > 0
    ? `Cost: ${formatUsd(cost.costUsd)}${cost.estimated ? ' (est.)' : ''}`
    : null

  return (
    <DropdownMenu.Root onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          aria-label="Chat options"
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-accent rounded transition-all"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[180px] glass-panel rounded-lg p-1.5 shadow-xl z-50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-1 duration-150"
          sideOffset={5}
          align="end"
          onClick={(e) => e.stopPropagation()}
        >
          {costLabel && (
            <>
              <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground font-medium">
                {costLabel}
              </DropdownMenu.Label>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
            </>
          )}
          {isArchived ? (
            // Archived chat menu
            <>
              <DropdownMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-accent transition-colors"
                onSelect={() => onRestore?.(chatId)}
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
                Restore
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
              <DropdownMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-red-500/20 text-red-400 transition-colors"
                onSelect={() => onDelete(chatId)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Permanently
              </DropdownMenu.Item>
            </>
          ) : (
            // Active chat menu
            <>
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-accent transition-colors data-[state=open]:bg-accent">
                  <FolderInput className="h-3.5 w-3.5" />
                  Move to...
                  <span className="ml-auto text-muted-foreground">▸</span>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    className="min-w-[160px] glass-panel rounded-lg p-1.5 shadow-xl z-50"
                    sideOffset={4}
                  >
                    <DropdownMenu.Item
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-accent transition-colors",
                        currentProjectId === null && "text-primary"
                      )}
                      onSelect={() => onMove(chatId, null)}
                      disabled={currentProjectId === null}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      Quick Chats
                      {currentProjectId === null && <span className="ml-auto text-xs">current</span>}
                    </DropdownMenu.Item>
                    {projects.length > 0 && (
                      <DropdownMenu.Separator className="h-px bg-border my-1" />
                    )}
                    {projects.map((project) => (
                      <DropdownMenu.Item
                        key={project.id}
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-accent transition-colors",
                          currentProjectId === project.id && "text-primary"
                        )}
                        onSelect={() => onMove(chatId, project.id)}
                        disabled={currentProjectId === project.id}
                      >
                        <span className="truncate max-w-[120px]">{project.name}</span>
                        {currentProjectId === project.id && <span className="ml-auto text-xs">current</span>}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>

              <DropdownMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-accent transition-colors"
                onSelect={() => onRename(chatId)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Rename
              </DropdownMenu.Item>

              <DropdownMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-accent transition-colors"
                onSelect={() => onArchive(chatId)}
              >
                <Archive className="h-3.5 w-3.5" />
                Archive
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="h-px bg-border my-1" />

              <DropdownMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-red-500/20 text-red-400 transition-colors"
                onSelect={() => onDelete(chatId)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
})
