'use client'

import { createContext, useContext } from 'react'
import type { SidebarActions } from './types'

const SidebarActionsContext = createContext<SidebarActions | null>(null)

export function SidebarActionsProvider({
  actions,
  children,
}: {
  actions: SidebarActions
  children: React.ReactNode
}) {
  return (
    <SidebarActionsContext.Provider value={actions}>
      {children}
    </SidebarActionsContext.Provider>
  )
}

export function useSidebarActions(): SidebarActions {
  const actions = useContext(SidebarActionsContext)
  if (!actions) {
    throw new Error('useSidebarActions must be used within a SidebarActionsProvider')
  }
  return actions
}
