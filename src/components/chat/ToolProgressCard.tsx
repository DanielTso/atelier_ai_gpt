'use client'

import { motion } from 'framer-motion'
import { FileText, ImageIcon, AlertCircle } from 'lucide-react'
import { ArtifactCard } from './ArtifactCard'
import type { ArtifactSummary } from '@/types'

// Live in-message rendering for the generate_image / generate_artifact tool
// parts: an in-progress card while the tool runs, settling into the real
// artifact card / inline image when the output arrives.

type ToolPartLike = {
  type?: string
  toolName?: string
  state?: string
  input?: unknown
  output?: unknown
}

/** The tool name when a part belongs to one of the two renderable tools, else null. */
export function toolPartName(p: unknown): 'generate_image' | 'generate_artifact' | null {
  const part = p as ToolPartLike
  const type = part.type ?? ''
  const name =
    type === 'dynamic-tool' ? (part.toolName ?? '')
    : type.startsWith('tool-') ? type.slice('tool-'.length)
    : ''
  return name === 'generate_image' || name === 'generate_artifact' ? name : null
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

export function ToolProgressCard({ part, fileUrls, onImageClick, onOpenArtifact }: {
  part: unknown
  /** Urls of file parts already rendered in this message — a settled image tool
      output with the same url is skipped (the persisted file part wins). */
  fileUrls: Set<string>
  onImageClick: (url: string) => void
  onOpenArtifact?: (id: number) => void
}) {
  const name = toolPartName(part)
  if (!name) return null
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
      if (!url || fileUrls.has(url)) return null
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
