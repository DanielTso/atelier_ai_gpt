'use client'

import { X, Download, FileSpreadsheet, FileType, FileText, Presentation } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ArtifactSummary } from '@/types'
import { ArtifactPreview } from './ArtifactPreview'

const ICON: Record<string, LucideIcon> = {
  xlsx: FileSpreadsheet,
  docx: FileType,
  pdf: FileText,
  pptx: Presentation,
}

/** Right-side workspace panel: header + inline preview + download for one artifact. */
export function ArtifactWorkspace({ artifact, onClose }: { artifact: ArtifactSummary; onClose: () => void }) {
  const Icon = ICON[artifact.type] ?? FileText
  return (
    <aside className="flex w-(--artifact-panel-width) shrink-0 flex-col gap-3 overflow-hidden border-l border-border/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{artifact.title}</p>
            <p className="text-xs text-muted-foreground">
              {artifact.type.toUpperCase()}{artifact.version ? ` · v${artifact.version}` : ''}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          title="Close"
          aria-label="Close artifact"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {artifact.downloadUrl && (
        <a
          href={artifact.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-start rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </a>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ArtifactPreview artifact={artifact} />
      </div>
    </aside>
  )
}
