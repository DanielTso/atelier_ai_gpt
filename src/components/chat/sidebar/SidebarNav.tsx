'use client'

import { Plus, FolderOpen, Boxes, SlidersHorizontal, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebarActions } from './SidebarActionsContext'

export function SidebarNav() {
  const actions = useSidebarActions()
  const items = [
    { label: 'New chat', icon: Plus, onClick: actions.createStandaloneChat, active: false },
    { label: 'Projects', icon: FolderOpen, onClick: () => actions.selectView('projects'), active: actions.activeView === 'projects' },
    { label: 'Artifacts', icon: Boxes, onClick: () => actions.selectView('artifacts'), active: actions.activeView === 'artifacts' },
    { label: 'Images', icon: ImageIcon, onClick: () => actions.selectView('images'), active: actions.activeView === 'images' },
    { label: 'Customize', icon: SlidersHorizontal, onClick: actions.openSettings, active: false },
  ]
  return (
    <nav className="px-2 space-y-0.5">
      {items.map(({ label, icon: Icon, onClick, active }) => (
        <button
          key={label}
          onClick={onClick}
          className={cn(
            'flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm transition-colors',
            active ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </button>
      ))}
    </nav>
  )
}
