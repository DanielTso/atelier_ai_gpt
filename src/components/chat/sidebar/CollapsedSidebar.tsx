'use client'

import { Plus, Settings, Sun, PanelLeftOpen } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import { useSidebarActions } from './SidebarActionsContext'
import { SmartChatMenu } from './SmartChatMenu'
import type { Project } from './types'

interface CollapsedSidebarProps {
  sortedProjects: Project[]
}

function CollapsedButton({ label, icon: Icon, onClick, className: btnClass }: {
  label: string
  icon: typeof Plus
  onClick: () => void
  className?: string
}) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            onClick={onClick}
            className={cn("p-2 rounded-lg hover:bg-accent transition-colors", btnClass)}
          >
            <Icon className="h-5 w-5" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="right"
            sideOffset={8}
            className="px-2 py-1 text-xs rounded bg-popover border border-border shadow-lg z-50"
          >
            {label}
            <Tooltip.Arrow className="fill-popover" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

export function CollapsedSidebar({ sortedProjects }: CollapsedSidebarProps) {
  const actions = useSidebarActions()

  return (
    <aside className="w-14 flex flex-col items-center glass-panel rounded-2xl py-4 px-1 transition-all duration-300 gap-2 shrink-0">
      <Tooltip.Provider delayDuration={200}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <img src="/logo.svg" alt="Atelier Studio" className="h-5 w-5" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="right"
              sideOffset={8}
              className="px-2 py-1 text-xs rounded bg-popover border border-border shadow-lg z-50"
            >
              Atelier Studio
              <Tooltip.Arrow className="fill-popover" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      <CollapsedButton label="Expand sidebar" icon={PanelLeftOpen} onClick={actions.toggleCollapse} />
      <div className="h-px w-full bg-border my-1" />
      {/* Smart Chat is its own dropdown; a wrapping Radix tooltip got stuck open when the
          menu opened (the menu portals over the trigger, so the tooltip never sees a
          pointer-leave). Use a native `title` on the button instead — it can't stick. */}
      <SmartChatMenu sortedProjects={sortedProjects} variant="collapsed" />
      <div className="flex-1" />
      <CollapsedButton label="Toggle theme" icon={Sun} onClick={actions.toggleTheme} />
      <CollapsedButton label="Settings" icon={Settings} onClick={actions.openSettings} />
    </aside>
  )
}
