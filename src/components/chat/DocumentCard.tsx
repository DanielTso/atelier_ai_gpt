'use client'
import { memo } from 'react'
import { Loader2, CheckCircle2, AlertCircle, Trash2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatFileSize, getFileTypeBadge } from '@/lib/fileUtils'
import type { DocumentSummary } from '@/types'

interface DocumentCardProps {
  doc: DocumentSummary
  onOpen: (doc: DocumentSummary) => void
  onDelete: (doc: DocumentSummary) => void
}

export const DocumentCard = memo(function DocumentCard({ doc, onOpen, onDelete }: DocumentCardProps) {
  const badge = getFileTypeBadge(doc.mimeType, doc.filename)
  return (
    <div
      onClick={() => onOpen(doc)}
      className="group relative text-left rounded-xl border border-border/30 overflow-hidden hover:bg-muted/30 hover:border-border/50 transition-colors cursor-pointer"
    >
      <div className="h-24 bg-muted/40 flex items-center justify-center overflow-hidden">
        {doc.thumbnailUrl ? (
          <img src={doc.thumbnailUrl} alt={doc.filename} className="h-full w-full object-cover" />
        ) : (
          <span className={cn('text-xs font-semibold px-2 py-1 rounded-full', badge.className)}>{badge.label}</span>
        )}
      </div>

      <div className="p-2.5">
        <p className="text-sm text-foreground truncate leading-tight">{doc.filename}</p>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
          {doc.status === 'uploading' && (
            <span className="flex items-center gap-1 text-amber-400"><Loader2 className="h-2.5 w-2.5 animate-spin" />Uploading</span>
          )}
          {doc.status === 'processing' && (
            <span className="flex items-center gap-1 text-amber-400"><Loader2 className="h-2.5 w-2.5 animate-spin" />Indexing</span>
          )}
          {doc.status === 'ready' && (
            <>
              <CheckCircle2 className="h-3 w-3 text-green-400" />
              {doc.chunkCount != null && <span>{doc.chunkCount} chunk{doc.chunkCount !== 1 ? 's' : ''}</span>}
            </>
          )}
          {doc.status === 'error' && (
            <span className="flex items-center gap-1 text-red-400"><AlertCircle className="h-3 w-3" />{doc.errorMessage || 'Failed'}</span>
          )}
          {doc.extractionMethod === 'vision' && (
            <span className="flex items-center gap-0.5 text-[10px] text-primary"><Sparkles className="h-2.5 w-2.5" />vision</span>
          )}
          <span className="ml-auto">{formatFileSize(doc.fileSize)}</span>
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onDelete(doc) }}
        className="absolute top-1.5 right-1.5 p-1 rounded bg-background/70 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Delete document"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})
