// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ArchivedChatsSection } from '@/components/chat/sidebar/ArchivedChatsSection'
import { SidebarActionsProvider } from '@/components/chat/sidebar/SidebarActionsContext'
import type { Chat, SidebarActions } from '@/components/chat/sidebar/types'

afterEach(cleanup)

const KEY = 'sidebar-archived-open'

const archived: Chat[] = [
  { id: 7, projectId: 5, title: 'Project archive', archived: true },
  { id: 8, projectId: null, title: 'Quick archive', archived: true },
]

// Records every action call; any member not overridden is a spy too.
function recordingActions() {
  const spies = new Map<PropertyKey, ReturnType<typeof vi.fn>>()
  const actions = new Proxy({ activeView: 'home' } as Record<PropertyKey, unknown>, {
    get: (t, k) => {
      if (k in t) return t[k]
      if (!spies.has(k)) spies.set(k, vi.fn())
      return spies.get(k)
    },
  }) as unknown as SidebarActions
  // Accepts any name so a test can assert a removed/legacy action never fires.
  const spy = (name: string) => {
    if (!spies.has(name)) spies.set(name, vi.fn())
    return spies.get(name)!
  }
  return { actions, spy }
}

function renderSection(chats: Chat[], actions = recordingActions().actions) {
  return render(
    <SidebarActionsProvider actions={actions}>
      <ArchivedChatsSection chats={chats} activeChatId={null} projects={[{ id: 5, name: 'Tower' }]} />
    </SidebarActionsProvider>
  )
}

describe('ArchivedChatsSection', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders nothing for an empty list', () => {
    const { container } = renderSection([])
    expect(container.firstChild).toBeNull()
  })

  it('shows a collapsed toggle with the count and hides the titles by default', () => {
    renderSection(archived)
    const toggle = screen.getByRole('button', { name: /archived/i })
    expect(toggle.textContent).toContain('2')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Project archive')).toBeNull()
    expect(screen.queryByText('Quick archive')).toBeNull()
  })

  it('expands on click and persists the open state', () => {
    renderSection(archived)
    const toggle = screen.getByRole('button', { name: /archived/i })
    fireEvent.click(toggle)
    expect(screen.getByText('Project archive')).toBeTruthy()
    expect(screen.getByText('Quick archive')).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(localStorage.getItem(KEY)).toBe('true')
  })

  it('renders collapsed when the persisted value is malformed', async () => {
    localStorage.setItem(KEY, '"yes"')
    renderSection(archived)
    // Let the deferred hydration effect run.
    await act(async () => {})
    const toggle = screen.getByRole('button', { name: /archived/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Project archive')).toBeNull()
  })

  it('opens a project-owned archived chat under its own project', () => {
    const { actions, spy } = recordingActions()
    renderSection(archived, actions)
    fireEvent.click(screen.getByRole('button', { name: /archived/i }))
    fireEvent.click(screen.getByText('Project archive'))
    expect(spy('openChat')).toHaveBeenCalledWith(7, 5)
    expect(spy('selectStandaloneChat')).not.toHaveBeenCalled()
    expect(spy('selectChat')).not.toHaveBeenCalled()
  })

  it('opens a standalone archived chat with no project', () => {
    const { actions, spy } = recordingActions()
    renderSection(archived, actions)
    fireEvent.click(screen.getByRole('button', { name: /archived/i }))
    fireEvent.click(screen.getByText('Quick archive'))
    expect(spy('openChat')).toHaveBeenCalledWith(8, null)
  })
})
