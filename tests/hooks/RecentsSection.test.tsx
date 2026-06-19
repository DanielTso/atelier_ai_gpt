// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { RecentsSection } from '@/components/chat/sidebar/RecentsSection'
import { SidebarActionsProvider } from '@/components/chat/sidebar/SidebarActionsContext'
import type { SidebarActions } from '@/components/chat/sidebar/types'

afterEach(cleanup)

const noopActions = new Proxy({}, { get: () => () => {} }) as SidebarActions

describe('RecentsSection', () => {
  it('renders a Recents header and one row per chat', () => {
    const chats = [
      { id: 1, projectId: null, title: 'Alpha chat' },
      { id: 2, projectId: 5, title: 'Beta chat' },
    ]
    render(
      <SidebarActionsProvider actions={noopActions}>
        <RecentsSection chats={chats} activeChatId={null} projects={[]} />
      </SidebarActionsProvider>
    )
    expect(screen.getByText('Recents')).toBeTruthy()
    expect(screen.getByText('Alpha chat')).toBeTruthy()
    expect(screen.getByText('Beta chat')).toBeTruthy()
  })
})
