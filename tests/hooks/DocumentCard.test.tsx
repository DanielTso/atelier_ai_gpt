// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentCard } from '@/components/chat/DocumentCard'
import type { DocumentSummary } from '@/types'

const base: DocumentSummary = {
  id: 1, filename: 'GradingPlan.pdf', mimeType: 'application/pdf', fileSize: 1000,
  chunkCount: 42, status: 'ready', errorMessage: null, revision: 1, updatedAt: null,
  url: 'signed:orig', thumbnailUrl: 'signed:thumb', extractionMethod: 'vision',
}

describe('DocumentCard', () => {
  it('renders the thumbnail image when thumbnailUrl is present', () => {
    render(<DocumentCard doc={base} onOpen={() => {}} onDelete={() => {}} />)
    const img = screen.getByRole('img', { name: /GradingPlan\.pdf/i }) as HTMLImageElement
    expect(img.src).toContain('signed:thumb')
  })

  it('shows the vision method chip and chunk count when ready', () => {
    render(<DocumentCard doc={base} onOpen={() => {}} onDelete={() => {}} />)
    expect(screen.getByText(/vision/i)).toBeTruthy()
    expect(screen.getByText(/42 chunks/i)).toBeTruthy()
  })

  it('falls back to a file-type tile when no thumbnail', () => {
    render(<DocumentCard doc={{ ...base, thumbnailUrl: null }} onOpen={() => {}} onDelete={() => {}} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('PDF')).toBeTruthy()
  })

  it('shows an uploading indicator for uploading status', () => {
    render(<DocumentCard doc={{ ...base, status: 'uploading', thumbnailUrl: null }} onOpen={() => {}} onDelete={() => {}} />)
    expect(screen.getByText(/uploading/i)).toBeTruthy()
  })

  it('calls onOpen when the card is clicked', () => {
    const onOpen = vi.fn()
    render(<DocumentCard doc={base} onOpen={onOpen} onDelete={() => {}} />)
    fireEvent.click(screen.getByText('GradingPlan.pdf'))
    expect(onOpen).toHaveBeenCalledWith(base)
  })
})
