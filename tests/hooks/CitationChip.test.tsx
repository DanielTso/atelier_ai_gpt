// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CitationChip } from '@/components/chat/CitationChip'
import type { Citation } from '@/lib/citations'

const doc = { filename: 'GradingPlan.pdf', pageCount: 40 }

describe('CitationChip', () => {
  it('renders a single-page label', () => {
    const cite: Citation = { docId: 1, page: 34 }
    render(<CitationChip cite={cite} doc={doc} onOpen={() => {}} />)
    expect(screen.getByText('GradingPlan.pdf · p.34')).toBeTruthy()
  })

  it('renders a page-range label with an en dash', () => {
    const cite: Citation = { docId: 1, page: 34, pageEnd: 36 }
    render(<CitationChip cite={cite} doc={doc} onOpen={() => {}} />)
    expect(screen.getByText('GradingPlan.pdf · p.34–36')).toBeTruthy()
  })

  it('renders the filename alone for a chunk-only citation', () => {
    const cite: Citation = { docId: 1, chunkId: 456 }
    render(<CitationChip cite={cite} doc={doc} onOpen={() => {}} />)
    expect(screen.getByText('GradingPlan.pdf')).toBeTruthy()
  })

  it('renders the filename alone for a doc-only citation', () => {
    const cite: Citation = { docId: 1 }
    render(<CitationChip cite={cite} doc={doc} onOpen={() => {}} />)
    expect(screen.getByText('GradingPlan.pdf')).toBeTruthy()
  })

  it('renders nothing when the docId is not in the project documents', () => {
    const cite: Citation = { docId: 999, page: 1 }
    const { container } = render(<CitationChip cite={cite} doc={undefined} onOpen={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('clamps a page beyond pageCount to a document-level open (no target)', () => {
    const onOpen = vi.fn()
    const cite: Citation = { docId: 1, page: 999 }
    render(<CitationChip cite={cite} doc={doc} onOpen={onOpen} />)
    // Over-range page degrades the label too — filename alone, not "p.999".
    const chip = screen.getByText('GradingPlan.pdf')
    fireEvent.click(chip)
    expect(onOpen).toHaveBeenCalledWith(1, {})
  })

  it('passes the page through as the open target when in range', () => {
    const onOpen = vi.fn()
    const cite: Citation = { docId: 1, page: 12 }
    render(<CitationChip cite={cite} doc={doc} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('GradingPlan.pdf · p.12'))
    expect(onOpen).toHaveBeenCalledWith(1, { page: 12 })
  })

  it('passes the chunkId through as the open target when there is no page', () => {
    const onOpen = vi.fn()
    const cite: Citation = { docId: 1, chunkId: 456 }
    render(<CitationChip cite={cite} doc={doc} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('GradingPlan.pdf'))
    expect(onOpen).toHaveBeenCalledWith(1, { chunkId: 456 })
  })

  it('treats a missing pageCount as unbounded (no clamp)', () => {
    const onOpen = vi.fn()
    const cite: Citation = { docId: 1, page: 9999 }
    render(<CitationChip cite={cite} doc={{ filename: 'Notes.txt', pageCount: null }} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('Notes.txt · p.9999'))
    expect(onOpen).toHaveBeenCalledWith(1, { page: 9999 })
  })

  it('sets the full label as the title attribute', () => {
    const cite: Citation = { docId: 1, page: 34, pageEnd: 36 }
    render(<CitationChip cite={cite} doc={doc} onOpen={() => {}} />)
    expect(screen.getByTitle('GradingPlan.pdf · p.34–36')).toBeTruthy()
  })
})
