// @vitest-environment jsdom
//
// The message menu's Delete and Regenerate items (audit D2, task C8): shown only
// when the message's DB row id can be resolved, Regenerate only on the last
// assistant reply, and neither while a reply is streaming.
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MessagesList, type ChatMessage } from '@/components/chat/MessagesList'

beforeAll(() => {
  // Radix DropdownMenu needs these pointer APIs which jsdom does not implement.
  Element.prototype.hasPointerCapture = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => cleanup())

const msg = (id: string, role: 'user' | 'assistant', text: string, metadata?: unknown) =>
  ({ id, role, parts: [{ type: 'text', text }], createdAt: new Date(), ...(metadata ? { metadata } : {}) }) as unknown as ChatMessage

// A chat loaded from the DB: every id is a stringified row id.
const LOADED = [msg('11', 'user', 'First question'), msg('12', 'assistant', 'First answer'), msg('13', 'user', 'Second question'), msg('14', 'assistant', 'Second answer')]

function renderList(messages: ChatMessage[], extra: { isLoading?: boolean } = {}) {
  const onDeleteMessage = vi.fn()
  const onRegenerate = vi.fn()
  render(
    <MessagesList
      messages={messages}
      isLoading={extra.isLoading ?? false}
      activeChatId={7}
      selectedModel="claude-sonnet-5"
      onDeleteMessage={onDeleteMessage}
      onRegenerate={onRegenerate}
    />,
  )
  return { onDeleteMessage, onRegenerate }
}

function openMenu(index: number) {
  const trigger = screen.getAllByRole('button', { name: 'Message actions' })[index]
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.pointerUp(trigger)
}

describe('MessagesList message actions', () => {
  it('Delete calls back with the message id', () => {
    const { onDeleteMessage } = renderList(LOADED)
    openMenu(1)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onDeleteMessage).toHaveBeenCalledWith('12')
  })

  it('offers Regenerate on the last assistant reply', () => {
    const { onRegenerate } = renderList(LOADED)
    openMenu(3)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate' }))
    expect(onRegenerate).toHaveBeenCalledWith('14')
  })

  it('does not offer Regenerate on an earlier assistant reply', () => {
    renderList(LOADED)
    openMenu(1)
    expect(screen.queryByRole('menuitem', { name: 'Regenerate' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
  })

  it('does not offer Regenerate on a last reply with no user message before it', () => {
    // e.g. the user message it answered was deleted
    renderList([msg('11', 'user', 'First question'), msg('12', 'assistant', 'First answer'), msg('14', 'assistant', 'Second answer')])
    openMenu(2)
    expect(screen.queryByRole('menuitem', { name: 'Regenerate' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
  })

  it('never offers Regenerate on a user message', () => {
    renderList([...LOADED, msg('15', 'user', 'Unanswered')])
    openMenu(4)
    expect(screen.queryByRole('menuitem', { name: 'Regenerate' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
  })

  it('offers both on a reply sent this session once its metadata carries the row ids', () => {
    const { onRegenerate } = renderList([
      msg('userSdkId0000001', 'user', 'Question'),
      msg('asstSdkId0000001', 'assistant', 'Answer', { chatId: 7, projectId: null, userMessageDbId: 20, assistantMessageDbId: 21 }),
    ])
    openMenu(1)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Regenerate' }))
    expect(onRegenerate).toHaveBeenCalledWith('asstSdkId0000001')
  })

  it('hides both while the reply has no row id (a stopped turn not yet looked up)', () => {
    renderList([
      msg('userSdkId0000001', 'user', 'Question'),
      msg('asstSdkId0000001', 'assistant', 'Partial', { chatId: 7, projectId: null, userMessageDbId: 20, assistantMessageDbId: null }),
    ])
    openMenu(1)
    expect(screen.queryByRole('menuitem', { name: 'Regenerate' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeTruthy()
  })

  it('hides both while a reply is streaming', () => {
    renderList(LOADED, { isLoading: true })
    openMenu(1)
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Regenerate' })).toBeNull()
  })
})
