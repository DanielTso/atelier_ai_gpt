'use client'

import { memo } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, FolderInput, Pencil, Archive, Trash2, MessageCircle, ArchiveRestore } from 'lucide-react'
import { cn } from '@/lib/utils'
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
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded transition-all"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[180px] glass-panel rounded-lg p-1.5 shadow-xl z-50"
          sideOffset={5}
          align="end"
          onClick={(e) => e.stopPropagation()}
        >
          {isArchived ? (
            // Archived chat menu
            <>
              <DropdownMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-white/10 transition-colors"
                onSelect={() => onRestore?.(chatId)}
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
                Restore
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="h-px bg-white/10 my-1" />
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
                <DropdownMenu.SubTrigger className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-white/10 transition-colors data-[state=open]:bg-white/10">
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
                        "flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-white/10 transition-colors",
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
                      <DropdownMenu.Separator className="h-px bg-white/10 my-1" />
                    )}
                    {projects.map((project) => (
                      <DropdownMenu.Item
                        key={project.id}
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-white/10 transition-colors",
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
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-white/10 transition-colors"
                onSelect={() => onRename(chatId)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Rename
              </DropdownMenu.Item>

              <DropdownMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-white/10 transition-colors"
                onSelect={() => onArchive(chatId)}
              >
                <Archive className="h-3.5 w-3.5" />
                Archive
              </DropdownMenu.Item>

              <DropdownMenu.Separator className="h-px bg-white/10 my-1" />

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
