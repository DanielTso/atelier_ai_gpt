// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ProjectLandingPage } from '@/components/chat/ProjectLandingPage'

// The context rail fetches suggestions/documents — out of scope for these tests.
vi.mock('@/components/chat/ProjectContextRail', () => ({
  ProjectContextRail: () => null,
}))

// Radix DropdownMenu needs these pointer APIs which jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

const PROJECT = { id: 3, name: 'Drover_HUB', memory: null, instructions: null }
const PROJECTS = [
  { id: 3, name: 'Drover_HUB' },
  { id: 4, name: 'CapRock_HUB' },
]
const PREVIEWS = [
  { id: 12, title: 'Storm sheets', preview: 'list every storm sheet', createdAt: new Date('2026-07-10') },
  { id: 13, title: 'RFI log', preview: null, createdAt: new Date('2026-07-11') },
]

function renderPage(overrides: Partial<React.ComponentProps<typeof ProjectLandingPage>> = {}) {
  const chatActions = {
    moveChat: vi.fn(),
    renameChat: vi.fn(),
    archiveChat: vi.fn(),
    deleteChat: vi.fn(),
  }
  const props = {
    project: PROJECT,
    projects: PROJECTS,
    chatPreviews: PREVIEWS,
    loading: false,
    composer: <div data-testid="composer" />,
    onSelectChat: vi.fn(),
    onAddFiles: vi.fn(),
    onSaveContext: vi.fn(),
    onDeleteProject: vi.fn(),
    onBack: vi.fn(),
    onRename: vi.fn(),
    chatActions,
    ...overrides,
  }
  render(<ProjectLandingPage {...props} />)
  return { ...props, chatActions }
}

function openChatMenu(index: number) {
  const triggers = screen.getAllByRole('button', { name: 'Chat options' })
  fireEvent.pointerDown(triggers[index], { button: 0, ctrlKey: false })
  fireEvent.pointerUp(triggers[index])
}

describe('ProjectLandingPage chat rows', () => {
  it('renders a context-menu trigger per chat row', () => {
    renderPage()
    expect(screen.getAllByRole('button', { name: 'Chat options' })).toHaveLength(2)
  })

  it('opens a chat when the row body is clicked', () => {
    const { onSelectChat, chatActions } = renderPage()
    fireEvent.click(screen.getByText('Storm sheets'))
    expect(onSelectChat).toHaveBeenCalledWith(12)
    expect(chatActions.renameChat).not.toHaveBeenCalled()
    expect(chatActions.deleteChat).not.toHaveBeenCalled()
  })

  it('opens a chat via keyboard (Enter) on the focused row', () => {
    const { onSelectChat } = renderPage()
    const row = screen.getByText('RFI log').closest('[role="button"][tabindex="0"]')!
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onSelectChat).toHaveBeenCalledWith(13)
  })

  it('does not open the chat when the menu trigger is clicked', () => {
    const { onSelectChat } = renderPage()
    const triggers = screen.getAllByRole('button', { name: 'Chat options' })
    fireEvent.click(triggers[0])
    expect(onSelectChat).not.toHaveBeenCalled()
  })

  it('fires renameChat from the menu', () => {
    const { chatActions, onSelectChat } = renderPage()
    openChatMenu(0)
    fireEvent.click(screen.getByText('Rename'))
    expect(chatActions.renameChat).toHaveBeenCalledWith(12)
    expect(onSelectChat).not.toHaveBeenCalled()
  })

  it('fires deleteChat from the menu', () => {
    const { chatActions } = renderPage()
    openChatMenu(1)
    fireEvent.click(screen.getByText('Delete'))
    expect(chatActions.deleteChat).toHaveBeenCalledWith(13)
  })

  it('fires archiveChat from the menu', () => {
    const { chatActions } = renderPage()
    openChatMenu(0)
    fireEvent.click(screen.getByText('Archive'))
    expect(chatActions.archiveChat).toHaveBeenCalledWith(12)
  })
})
