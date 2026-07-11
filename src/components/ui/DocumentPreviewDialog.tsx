'use client'

import { memo, useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { DIALOG_OVERLAY_ANIM, DIALOG_CONTENT_ANIM } from '@/lib/motion'
import { X, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatFileSize, getFileTypeBadge } from '@/lib/fileUtils'
import { getDocumentChunks } from '@/app/actions'
import type { DocumentSummary } from '@/types'

interface DocumentPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: DocumentSummary | null
}

export const DocumentPreviewDialog = memo(function DocumentPreviewDialog({
  open,
  onOpenChange,
  document: doc,
}: DocumentPreviewDialogProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)

  // hasVisual must be computed before hooks — safe with optional chaining when doc is null
  const hasVisual = !!doc && !!doc.url && (doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf')

  const [tab, setTab] = useState<'preview' | 'text'>('preview')

  useEffect(() => {
    if (!open || !doc) return
    setLoading(true)
    setContent('')
    getDocumentChunks(doc.id).then(chunks => {
      // Chunks have overlap — deduplicate by using only the non-overlapping portion
      // except for the last chunk which we take in full
      const texts = chunks.map(c => c.content)
      setContent(deduplicateChunks(texts))
    }).catch(() => {
      setContent('Failed to load document content.')
    }).finally(() => {
      setLoading(false)
    })
  }, [open, doc])

  if (!doc) return null

  const badge = getFileTypeBadge(doc.mimeType, doc.filename)
  // Clamp rather than reset via an effect (avoids setState-in-effect): a doc with
  // no visual original always shows the text tab regardless of the last selection.
  const activeTab: 'preview' | 'text' = hasVisual ? tab : 'text'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-50 ${DIALOG_OVERLAY_ANIM}`} />
        <Dialog.Content className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl glass-panel rounded-2xl p-6 z-50 shadow-xl max-h-[80vh] flex flex-col ${DIALOG_CONTENT_ANIM}`}>
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold flex items-center gap-2 min-w-0">
              <FileText className="h-5 w-5 text-blue-400 shrink-0" />
              <span className="truncate">{doc.filename}</span>
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full shrink-0", badge.className)}>
                {badge.label}
              </span>
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-accent transition-colors shrink-0 ml-2">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Meta */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
            <span>{formatFileSize(doc.fileSize)}</span>
            {doc.chunkCount != null && (
              <span>{doc.chunkCount} chunk{doc.chunkCount !== 1 ? 's' : ''}</span>
            )}
          </div>

          {doc.extractionPartial && (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              {doc.pagesExtracted != null && doc.pageCount != null && doc.pagesExtracted < doc.pageCount
                ? `Partial extraction — extracted ${doc.pagesExtracted} of ${doc.pageCount} pages. Some content may be missing.`
                : 'Partial extraction — some content may be missing.'}
            </div>
          )}

          {/* Tab strip */}
          <div className="flex items-center gap-2 mb-3 text-sm">
            <div role="tablist" className="flex items-center gap-1">
              {hasVisual && (
                <button role="tab" aria-selected={activeTab === 'preview'} onClick={() => setTab('preview')}
                  className={cn('px-3 py-1.5 rounded-lg', activeTab === 'preview' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50')}>Preview</button>
              )}
              <button role="tab" aria-selected={activeTab === 'text'} onClick={() => setTab('text')}
                className={cn('px-3 py-1.5 rounded-lg', activeTab === 'text' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50')}>Extracted text</button>
            </div>
            {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" className="ml-auto px-3 py-1.5 text-xs text-primary hover:underline">Open original ↗</a>}
          </div>

          {/* Content panel */}
          <div className="flex-1 overflow-y-auto min-h-0 rounded-lg bg-muted border border-border">
            {hasVisual && activeTab === 'preview' ? (
              doc.mimeType.startsWith('image/')
                // eslint-disable-next-line @next/next/no-img-element -- signed Supabase URL, not a static asset
                ? <img src={doc.url!} alt={doc.filename} className="w-full h-full object-contain" />
                : <iframe src={doc.url!} title={doc.filename} className="w-full h-full min-h-[60vh]" />
            ) : (
              <div className="p-4">
                {loading
                  ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  : <pre className="text-sm text-foreground/90 whitespace-pre-wrap break-words font-mono leading-relaxed">{content}</pre>}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
})

/**
 * Chunks are created with 400-char overlap. Reconstruct the original text by
 * finding and removing the overlapping prefix of each subsequent chunk.
 */
function deduplicateChunks(texts: string[]): string {
  if (texts.length === 0) return ''
  let result = texts[0]
  for (let i = 1; i < texts.length; i++) {
    const prev = texts[i - 1]
    const curr = texts[i]
    // Find the longest suffix of prev that is a prefix of curr
    let overlap = 0
    const maxCheck = Math.min(prev.length, curr.length, 500)
    for (let len = 1; len <= maxCheck; len++) {
      if (prev.endsWith(curr.substring(0, len))) {
        overlap = len
      }
    }
    result += curr.substring(overlap)
  }
  return result
}
