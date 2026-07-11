'use client'
import { memo } from 'react'
import { Download, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ArtifactSummary } from '@/types'
import { ARTIFACT_TYPE_LABELS } from '@/types'
import { ArtifactThumbnail } from './ArtifactThumbnail'

function relativeTime(d: Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  const secs = Math.floor((Date.now() - date.getTime()) / 1000)
  const units: [number, string][] = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']]
  for (const [s, label] of units) {
    const v = Math.floor(secs / s)
    if (v >= 1) return `${v} ${label}${v > 1 ? 's' : ''} ago`
  }
  return 'just now'
}

export const ArtifactGalleryCard = memo(function ArtifactGalleryCard({ artifact, onOpen, onOpenChat }: {
  artifact: ArtifactSummary
  onOpen: (id: number) => void
  onOpenChat?: (chatId: number) => void
}) {
  const label = ARTIFACT_TYPE_LABELS[artifact.type] ?? artifact.type.toUpperCase()
  const source = artifact.projectName ?? artifact.chatTitle ?? 'Chat'
  return (
    <div
      onClick={() => onOpen(artifact.id)}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-card hover:border-foreground/30 hover:shadow-md motion-safe:hover:-translate-y-0.5 transition-[transform,box-shadow,border-color] duration-200"
    >
      <ArtifactThumbnail artifact={artifact} />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="line-clamp-2 text-sm font-medium text-foreground">{artifact.title}</p>
        <div className="mt-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide">{label}</span>
          <span aria-hidden>·</span>
          <span>Edited {relativeTime(artifact.editedAt ?? artifact.createdAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenChat?.(artifact.chatId) }}
            className="inline-flex max-w-[70%] items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
          >
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span className="truncate">{source}</span>
          </button>
          {artifact.downloadUrl && (
            <a
              href={artifact.downloadUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] opacity-0 transition-opacity',
                'bg-primary text-primary-foreground hover:bg-primary/90 group-hover:opacity-100')}
            >
              <Download className="h-3 w-3" /> Download
            </a>
          )}
        </div>
      </div>
    </div>
  )
})
