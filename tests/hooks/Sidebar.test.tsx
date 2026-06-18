// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Sidebar } from '@/components/chat/sidebar/Sidebar'
import type { SidebarActions } from '@/components/chat/sidebar/types'

afterEach(cleanup)
const actions = new Proxy({ activeView: 'home' }, { get: (t, k) => (k in t ? (t as never)[k] : () => {}) }) as SidebarActions

describe('Sidebar', () => {
  it('renders the Claude.ai nav and Recents, not Quick Chats', () => {
    render(
      <Sidebar projects={[]} activeProjectId={null} chats={[{ id: 1, projectId: null, title: 'Recent one' }]}
        activeChatId={null} standaloneChats={[]} archivedChats={[]} collapsed={false} actions={actions} />
    )
    expect(screen.getByRole('button', { name: /new chat/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /projects/i })).toBeTruthy()
    expect(screen.getByText('Recents')).toBeTruthy()
    expect(screen.getByText('Recent one')).toBeTruthy()
    expect(screen.queryByText('Quick Chats')).toBeNull()
  })
})
