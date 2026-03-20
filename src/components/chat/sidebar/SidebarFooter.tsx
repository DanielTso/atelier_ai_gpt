'use client'

import { Settings } from 'lucide-react'
import { useSidebarActions } from './SidebarActionsContext'

export function SidebarFooter() {
  const actions = useSidebarActions()

  return (
    <div className="mx-4 mt-4 pt-4 border-t border-transparent" style={{ borderImage: 'linear-gradient(to right, transparent, rgba(255,255,255,0.1), transparent) 1' }}>
      <button
        onClick={actions.openSettings}
        className="flex items-center gap-2 p-2.5 w-full rounded-xl hover:bg-white/5 text-sm text-muted-foreground hover:text-foreground transition-all group"
      >
        <Settings className="h-4 w-4 group-hover:text-blue-400 transition-colors" />
        Settings
      </button>
    </div>
  )
}
