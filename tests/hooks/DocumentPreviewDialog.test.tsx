// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/app/actions', () => ({ getDocumentChunks: vi.fn(async () => [{ id: 1, chunkIndex: 0, content: 'EXTRACTED BODY TEXT' }]) }))

import { DocumentPreviewDialog } from '@/components/ui/DocumentPreviewDialog'
import { getDocumentChunks } from '@/app/actions'
import type { DocumentSummary } from '@/types'

// jsdom doesn't implement scrollIntoView — stub it so the chunk-target scroll
// behavior can be asserted without throwing.
const scrollIntoViewMock = vi.fn()
Element.prototype.scrollIntoView = scrollIntoViewMock

const pdf: DocumentSummary = {
  id: 1, filename: 'plan.pdf', mimeType: 'application/pdf', fileSize: 10, chunkCount: 1,
  status: 'ready', errorMessage: null, url: 'signed:plan', thumbnailUrl: 'signed:t', extractionMethod: 'vision',
  revision: 1, updatedAt: null, failedPages: null,
}

describe('DocumentPreviewDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDocumentChunks).mockResolvedValue([{ id: 1, chunkIndex: 0, content: 'EXTRACTED BODY TEXT' }])
  })

  it('shows a Preview tab with the original for a PDF', async () => {
    render(<DocumentPreviewDialog open document={pdf} onOpenChange={() => {}} />)
    expect(await screen.findByRole('tab', { name: /preview/i })).toBeTruthy()
    expect(screen.getByTitle(/plan\.pdf/i)).toBeTruthy() // iframe titled with the filename
  })

  it('hides the Preview tab for a non-visual document (text)', async () => {
    const txt = { ...pdf, filename: 'notes.txt', mimeType: 'text/plain', url: 'signed:n' }
    render(<DocumentPreviewDialog open document={txt} onOpenChange={() => {}} />)
    expect(await screen.findByText(/EXTRACTED BODY TEXT/)).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /preview/i })).toBeNull()
  })

  it('has no target: defaults to the Preview tab with a plain iframe src', async () => {
    render(<DocumentPreviewDialog open document={pdf} onOpenChange={() => {}} />)
    const iframe = await screen.findByTitle(/plan\.pdf/i)
    expect(iframe.getAttribute('src')).toBe('signed:plan')
    expect(screen.getByRole('tab', { name: /preview/i }).getAttribute('aria-selected')).toBe('true')
  })

  it('page target: iframe src carries a #page= fragment', async () => {
    render(<DocumentPreviewDialog open document={pdf} onOpenChange={() => {}} target={{ page: 4 }} />)
    const iframe = await screen.findByTitle(/plan\.pdf/i)
    expect(iframe.getAttribute('src')).toBe('signed:plan#page=4')
  })

  it('page target: clamps to the document pageCount when known', async () => {
    const capped = { ...pdf, pageCount: 2 }
    render(<DocumentPreviewDialog open document={capped} onOpenChange={() => {}} target={{ page: 9 }} />)
    const iframe = await screen.findByTitle(/plan\.pdf/i)
    expect(iframe.getAttribute('src')).toBe('signed:plan#page=2')
  })

  it('chunk target: opens on the Extracted-text tab and scrolls to the matching chunk', async () => {
    vi.mocked(getDocumentChunks).mockResolvedValue([
      { id: 10, chunkIndex: 0, content: 'Alpha section text.' },
      { id: 11, chunkIndex: 1, content: 'Beta section with the answer.' },
    ])
    render(<DocumentPreviewDialog open document={pdf} onOpenChange={() => {}} target={{ chunkId: 11 }} />)

    expect(screen.getByRole('tab', { name: /extracted text/i }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTitle(/plan\.pdf/i)).toBeNull() // preview iframe not rendered while on the text tab

    const target = await screen.findByText(/Beta section with the answer/)
    expect(target.getAttribute('data-chunk-id')).toBe('11')
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'start' })
    expect(scrollIntoViewMock.mock.instances[0]).toBe(target)
  })

  it('chunk target: an unmatched chunk id opens the text tab at the top without erroring', async () => {
    vi.mocked(getDocumentChunks).mockResolvedValue([{ id: 20, chunkIndex: 0, content: 'Only chunk.' }])
    render(<DocumentPreviewDialog open document={pdf} onOpenChange={() => {}} target={{ chunkId: 999 }} />)

    expect(await screen.findByText(/Only chunk/)).toBeTruthy()
    expect(screen.getByRole('tab', { name: /extracted text/i }).getAttribute('aria-selected')).toBe('true')
    expect(scrollIntoViewMock).not.toHaveBeenCalled()
  })
})
