'use client'

import { Sun, Moon, PanelLeftClose } from 'lucide-react'
import { useSidebarActions } from './SidebarActionsContext'

export function SidebarHeader() {
  const actions = useSidebarActions()

  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-3 mb-2 border-b border-border">
      <button
        type="button"
        onClick={actions.createStandaloneChat}
        title="Home"
        aria-label="Home"
        className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <img src="/logo.svg" alt="Atelier Studio" className="h-6 w-6" />
        <h1 className="text-xl font-bold text-foreground">
          Atelier Studio
        </h1>
      </button>
      <div className="flex items-center gap-1">
        <button
          onClick={actions.toggleTheme}
          className="relative p-2 rounded-full hover:bg-accent transition-colors"
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all duration-300 dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute top-2 left-2 h-5 w-5 rotate-90 scale-0 transition-all duration-300 dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </button>
        <button
          onClick={actions.toggleCollapse}
          className="p-2 rounded-full hover:bg-accent transition-colors text-muted-foreground"
          title="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
