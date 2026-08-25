// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('@/app/actions', () => ({
  getChatCost: vi.fn(),
}))

import { getChatCost } from '@/app/actions'
import { ChatContextMenu } from '@/components/chat/ChatContextMenu'

const mockGetChatCost = getChatCost as ReturnType<typeof vi.fn>

// Radix DropdownMenu needs these pointer APIs which jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

function openMenu() {
  const trigger = screen.getByLabelText('Chat options')
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.pointerUp(trigger)
}

const noop = () => {}

function renderMenu(chatId = 1) {
  render(
    <ChatContextMenu
      chatId={chatId}
      currentProjectId={null}
      projects={[]}
      onMove={noop}
      onRename={noop}
      onArchive={noop}
      onDelete={noop}
    />
  )
}

describe('ChatContextMenu — per-chat cost line', () => {
  beforeEach(() => { mockGetChatCost.mockReset() })

  it('does not fetch cost until the menu is opened, then shows it', async () => {
    mockGetChatCost.mockResolvedValue({ costUsd: 0.08, estimated: false })
    renderMenu(42)
    expect(mockGetChatCost).not.toHaveBeenCalled()
    openMenu()
    expect(await screen.findByText('Cost: $0.08')).toBeTruthy()
    expect(mockGetChatCost).toHaveBeenCalledWith(42)
  })

  it('hides the line when cost is zero', async () => {
    mockGetChatCost.mockResolvedValue({ costUsd: 0, estimated: false })
    renderMenu()
    openMenu()
    await waitFor(() => expect(mockGetChatCost).toHaveBeenCalled())
    expect(screen.queryByText(/Cost:/)).toBeNull()
  })

  it('hides the line while cost is unknown (fetch not yet resolved)', () => {
    mockGetChatCost.mockReturnValue(new Promise(() => {}))
    renderMenu()
    openMenu()
    expect(screen.queryByText(/Cost:/)).toBeNull()
  })

  it('hides the line on a fetch failure rather than throwing, and logs it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetChatCost.mockRejectedValue(new Error('boom'))
    renderMenu()
    openMenu()
    await waitFor(() => expect(mockGetChatCost).toHaveBeenCalled())
    expect(screen.queryByText(/Cost:/)).toBeNull()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('appends "(est.)" when the total is an estimate', async () => {
    mockGetChatCost.mockResolvedValue({ costUsd: 1.2, estimated: true })
    renderMenu()
    openMenu()
    expect(await screen.findByText('Cost: $1.20 (est.)')).toBeTruthy()
  })

  it('does not throw when the menu unmounts before the fetch resolves', async () => {
    let resolveFn: (v: { costUsd: number; estimated: boolean }) => void = () => {}
    mockGetChatCost.mockReturnValue(new Promise(resolve => { resolveFn = resolve }))
    const { unmount } = render(
      <ChatContextMenu chatId={1} currentProjectId={null} projects={[]} onMove={noop} onRename={noop} onArchive={noop} onDelete={noop} />
    )
    openMenu()
    await waitFor(() => expect(mockGetChatCost).toHaveBeenCalled())
    unmount()
    // Resolves after the component is gone — the unmounted-ref guard means
    // this must not throw or attempt a DOM update.
    expect(() => resolveFn({ costUsd: 5, estimated: false })).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})
