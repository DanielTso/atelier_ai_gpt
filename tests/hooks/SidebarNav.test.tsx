// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SidebarNav } from '@/components/chat/sidebar/SidebarNav'
import { SidebarActionsProvider } from '@/components/chat/sidebar/SidebarActionsContext'
import type { SidebarActions } from '@/components/chat/sidebar/types'

afterEach(cleanup)

function actionsWith(overrides: Partial<SidebarActions>): SidebarActions {
  return new Proxy(overrides, { get: (t, k) => (k in t ? (t as never)[k] : () => {}) }) as SidebarActions
}

describe('SidebarNav', () => {
  it('fires the right action per nav item', () => {
    const createStandaloneChat = vi.fn(), selectView = vi.fn(), openSettings = vi.fn()
    render(
      <SidebarActionsProvider actions={actionsWith({ createStandaloneChat, selectView, openSettings, activeView: 'home' })}>
        <SidebarNav />
      </SidebarActionsProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))
    fireEvent.click(screen.getByRole('button', { name: /projects/i }))
    fireEvent.click(screen.getByRole('button', { name: /artifacts/i }))
    fireEvent.click(screen.getByRole('button', { name: /customize/i }))
    expect(createStandaloneChat).toHaveBeenCalledOnce()
    expect(selectView).toHaveBeenCalledWith('projects')
    expect(selectView).toHaveBeenCalledWith('artifacts')
    expect(openSettings).toHaveBeenCalledOnce()
  })
})
