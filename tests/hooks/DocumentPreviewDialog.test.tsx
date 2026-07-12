// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/app/actions', () => ({ getDocumentChunks: vi.fn(async () => [{ chunkIndex: 0, content: 'EXTRACTED BODY TEXT' }]) }))

import { DocumentPreviewDialog } from '@/components/ui/DocumentPreviewDialog'
import type { DocumentSummary } from '@/types'

const pdf: DocumentSummary = {
  id: 1, filename: 'plan.pdf', mimeType: 'application/pdf', fileSize: 10, chunkCount: 1,
  status: 'ready', errorMessage: null, url: 'signed:plan', thumbnailUrl: 'signed:t', extractionMethod: 'vision',
  revision: 1, updatedAt: null, failedPages: null,
}

describe('DocumentPreviewDialog', () => {
  beforeEach(() => vi.clearAllMocks())

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
})
