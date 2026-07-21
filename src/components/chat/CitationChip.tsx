'use client'

import { memo } from 'react'
import { cn } from '@/lib/utils'
import type { Citation } from '@/lib/citations'

export interface CitationDoc {
  filename: string
  pageCount: number | null
}

export interface CitationChipProps {
  cite: Citation
  doc?: CitationDoc
  onOpen: (docId: number, target: { page?: number; chunkId?: number }) => void
}

// A page reference beyond the document's known page count can't be a real
// jump target (stale/hallucinated page number) — degrade to a document-level
// open instead of a broken deep link.
function isPageInRange(cite: Citation, doc: CitationDoc): boolean {
  return cite.page !== undefined && !(doc.pageCount != null && cite.page > doc.pageCount)
}

function citationTarget(cite: Citation, doc: CitationDoc): { page?: number; chunkId?: number } {
  if (isPageInRange(cite, doc)) return { page: cite.page }
  if (cite.chunkId !== undefined) return { chunkId: cite.chunkId }
  return {}
}

function citationLabel(cite: Citation, doc: CitationDoc): string {
  if (isPageInRange(cite, doc)) {
    if (cite.pageEnd !== undefined && cite.pageEnd !== cite.page) {
      return `${doc.filename} · p.${cite.page}–${cite.pageEnd}`
    }
    return `${doc.filename} · p.${cite.page}`
  }
  return doc.filename
}

// Renders a [cite:…] marker as a compact inline chip. Unknown docId (not in
// the project's document set) → render nothing; the raw marker is stripped
// rather than shown as broken/garbled text.
export const CitationChip = memo(function CitationChip({ cite, doc, onOpen }: CitationChipProps) {
  if (!doc) return null

  const target = citationTarget(cite, doc)
  const label = citationLabel(cite, doc)

  return (
    <button
      type="button"
      onClick={() => onOpen(cite.docId, target)}
      title={label}
      className={cn(
        'inline-flex items-baseline align-baseline mx-0.5 px-1.5 py-0.5 rounded-md text-xs leading-none',
        'bg-accent text-muted-foreground hover:bg-primary/10 hover:ring-1 hover:ring-primary/30 transition-colors',
      )}
    >
      {label}
    </button>
  )
})
