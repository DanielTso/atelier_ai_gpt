// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MessagesList, type ChatMessage, type DocumentsById } from '@/components/chat/MessagesList'

afterEach(() => cleanup())

// A cite marker inside a real assistant message, rendered through MessagesList's
// actual react-markdown + remarkCitations pipeline. This proves the hProperties
// casing (docId/page) survives the mdast → hast → JSX round-trip and reaches the
// CitationChip component as real props — the render seam T7/T8 could not cover.
const documentsById: DocumentsById = new Map([[1, { filename: 'GradingPlan.pdf', pageCount: 40 }]])

function renderWithCite(text: string, onOpenCitation = vi.fn()) {
  const messages: ChatMessage[] = [
    { id: 'a1', role: 'assistant', parts: [{ type: 'text', text }], createdAt: new Date() } as unknown as ChatMessage,
  ]
  render(
    <MessagesList
      messages={messages}
      isLoading={false}
      activeChatId={7}
      selectedModel="claude-sonnet-5"
      documentsById={documentsById}
      onOpenCitation={onOpenCitation}
    />,
  )
  return onOpenCitation
}

describe('MessagesList citation render seam', () => {
  it('renders a page-cite marker as a CitationChip with the resolved label', async () => {
    renderWithCite('See the grading note [cite:1 p34] for details.')
    expect(await screen.findByText('GradingPlan.pdf · p.34')).toBeTruthy()
  })

  it('clicking the chip opens the citation with the page target', async () => {
    const onOpenCitation = renderWithCite('Refer to [cite:1 p12] here.')
    fireEvent.click(await screen.findByText('GradingPlan.pdf · p.12'))
    expect(onOpenCitation).toHaveBeenCalledWith(1, { page: 12 })
  })

  it('drops a chip whose docId is not in the project document set', async () => {
    renderWithCite('Missing source [cite:999 p3] here.')
    // The unknown-doc chip renders nothing; the sentence text still shows.
    expect(await screen.findByText(/Missing source/)).toBeTruthy()
    expect(screen.queryByText(/p\.3/)).toBeNull()
  })
})

// Review F3: the floor caption is gated on a SESSION set of grounded-finished
// message ids (isGroundedTurn), not the composer's current grounded flag —
// historical/reloaded messages can never false-positive.
describe('grounded floor caption (session-gated)', () => {
  const CAPTION = 'Answered from project documents'

  function renderList(text: string, isGroundedTurn?: (id: string) => boolean) {
    const messages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text }], createdAt: new Date() } as unknown as ChatMessage,
    ]
    render(
      <MessagesList
        messages={messages}
        isLoading={false}
        activeChatId={7}
        selectedModel="claude-sonnet-5"
        documentsById={documentsById}
        isGroundedTurn={isGroundedTurn}
      />,
    )
  }

  it('shows the caption for a session-grounded turn with zero cite markers', () => {
    renderList('Plain answer with no markers.', id => id === 'a1')
    expect(screen.getByText(CAPTION)).toBeTruthy()
  })

  it('never shows the caption for historical messages (not in the session set)', () => {
    // Default membership (nothing finished grounded this session) — a loaded
    // marker-less history message must not get the caption.
    renderList('Plain answer with no markers.')
    expect(screen.queryByText(CAPTION)).toBeNull()
  })

  it('suppresses the caption when the grounded turn carries a cite marker', async () => {
    renderList('Cited answer [cite:1 p3].', id => id === 'a1')
    expect(await screen.findByText('GradingPlan.pdf · p.3')).toBeTruthy()
    expect(screen.queryByText(CAPTION)).toBeNull()
  })
})
