'use client'

import { motion } from 'framer-motion'
import { FileText, ImageIcon, AlertCircle } from 'lucide-react'
import { ArtifactCard } from './ArtifactCard'
import { toolPartName, isRenderableTool } from '@/lib/chatStage'
import type { ArtifactSummary } from '@/types'

// Live in-message rendering for the generate_image / generate_artifact tool
// parts: an in-progress card while the tool runs, settling into the real
// artifact card / inline image when the output arrives.

type ToolPartLike = {
  state?: string
  input?: unknown
  output?: unknown
}

/** True for parts this card renders (the two renderable tools). */
export function isToolCardPart(p: unknown): boolean {
  return isRenderableTool(toolPartName(p))
}

/** Artifact ids already rendered inline via tool outputs — the below-messages
    block filters these out so a live session never shows the same card twice. */
export function extractInlineArtifactIds(messages: { parts?: readonly unknown[] }[]): Set<number> {
  const ids = new Set<number>()
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (toolPartName(p) !== 'generate_artifact') continue
      const o = (p as ToolPartLike).output as Record<string, unknown> | undefined
      if (o && typeof o.artifactId === 'number') ids.add(o.artifactId)
    }
  }
  return ids
}

// Signed Storage URLs for the same object differ only in their query string —
// dedup on pathname so a re-signed url can never cause a double render.
function urlPath(u: string): string {
  try { return new URL(u).pathname } catch { return u }
}

export function ToolProgressCard({ part, fileUrls, onImageClick, onOpenArtifact, stalled = false }: {
  part: unknown
  /** Urls of file parts already rendered in this message — a settled image tool
      output for the same object is skipped (the persisted file part wins). */
  fileUrls: ReadonlySet<string>
  onImageClick: (url: string) => void
  onOpenArtifact?: (id: number) => void
  /** True when the message is no longer streaming — an input-* part can never
      complete now (interrupted stream / truncated tool call), so render a clear
      interrupted state instead of an eternal shimmer. */
  stalled?: boolean
}) {
  const name = toolPartName(part)
  if (!isRenderableTool(name)) return null
  const p = part as ToolPartLike
  const input = (p.input ?? {}) as Record<string, unknown>
  const output = p.output as Record<string, unknown> | undefined
  const isImage = name === 'generate_image'

  if (p.state === 'output-error') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive my-2">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        {isImage ? 'Image generation failed.' : 'File generation failed.'}
      </p>
    )
  }

  if (p.state === 'output-available') {
    if (isImage) {
      const url = typeof output?.url === 'string' ? output.url : null
      if (!url) return null
      const path = urlPath(url)
      for (const f of fileUrls) if (urlPath(f) === path) return null
      return (
        <motion.button
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          onClick={() => onImageClick(url)}
          className="block rounded-lg overflow-hidden border border-border shadow-lg my-2 cursor-zoom-in"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Generated image" className="object-contain max-w-lg max-h-128" />
        </motion.button>
      )
    }
    if (output && typeof output.artifactId === 'number') {
      const summary: ArtifactSummary = {
        id: output.artifactId,
        chatId: 0,
        type: typeof output.type === 'string' ? output.type : '',
        title: typeof output.title === 'string' ? output.title : 'Artifact',
        status: 'ready',
        downloadUrl: typeof output.downloadUrl === 'string' ? output.downloadUrl : null,
        createdAt: null,
      }
      return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          <ArtifactCard artifact={summary} onOpen={onOpenArtifact} />
        </motion.div>
      )
    }
    return null
  }

  // In progress (input-streaming / input-available)
  const Icon = isImage ? ImageIcon : FileText
  const detail =
    typeof input.title === 'string' ? input.title
    : typeof input.prompt === 'string' ? input.prompt
    : null
  if (stalled) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground my-2">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        {isImage ? 'Image generation was interrupted' : 'Document build was interrupted'}
        {detail ? ` — ${detail}` : ''}. Ask me to try again.
      </p>
    )
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-start gap-3 rounded-xl border border-border/40 bg-card/50 p-3 my-2 max-w-sm"
    >
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
        <Icon className="h-4.5 w-4.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-shimmer">{isImage ? 'Creating image…' : 'Building document…'}</p>
        {detail && <p className="text-xs text-muted-foreground truncate mt-0.5">{detail}</p>}
        <div className="skeleton-shimmer h-1.5 w-full mt-2 rounded-full" />
      </div>
    </motion.div>
  )
}
