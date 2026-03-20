'use client'

import { Folder, Zap } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useSidebarActions } from './SidebarActionsContext'
import type { Project } from './types'

interface SmartChatMenuProps {
  sortedProjects: Project[]
  variant: 'collapsed' | 'expanded'
}

export function SmartChatMenu({ sortedProjects, variant }: SmartChatMenuProps) {
  const actions = useSidebarActions()

  const menuContent = (
    <>
      <DropdownMenu.Item
        onClick={actions.createStandaloneChat}
        className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-white/10 outline-none transition-colors"
      >
        <Zap className="h-3.5 w-3.5 text-muted-foreground" />
        Quick Chat
      </DropdownMenu.Item>
      {sortedProjects.length > 0 && <DropdownMenu.Separator className="h-px bg-white/10 my-1" />}
      {sortedProjects.map(p => (
        <DropdownMenu.Item
          key={p.id}
          onClick={() => actions.createChatInProject(p.id)}
          className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-white/10 outline-none transition-colors"
        >
          <Folder className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate">{p.name}</span>
        </DropdownMenu.Item>
      ))}
    </>
  )

  if (variant === 'collapsed') {
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="p-2 rounded-lg hover:bg-white/10 transition-colors text-primary">
            <Zap className="h-5 w-5" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="right"
            sideOffset={8}
            className="min-w-[180px] glass-panel rounded-xl p-1.5 shadow-2xl border border-white/10 z-50"
          >
            {menuContent}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    )
  }

  return (
    <div className="px-4 mb-4">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex items-center gap-2 w-full p-3 rounded-xl bg-gradient-to-r from-blue-500/15 to-purple-500/15 hover:from-blue-500/25 hover:to-purple-500/25 text-primary border border-white/5 hover:border-white/10 transition-all font-medium">
            <Zap className="h-4 w-4" />
            Smart Chat
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="bottom"
            align="start"
            sideOffset={6}
            className="min-w-[200px] glass-panel rounded-xl p-1.5 shadow-2xl border border-white/10 z-50"
          >
            {menuContent}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
