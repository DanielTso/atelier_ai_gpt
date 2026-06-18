'use client'
import { memo } from 'react'
import { FileSpreadsheet, FileText, FileType, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ArtifactSummary } from '@/types'

const ICON: Record<string, typeof FileText> = { xlsx: FileSpreadsheet, docx: FileType, pdf: FileText }

export const ArtifactCard = memo(function ArtifactCard({ artifact }: { artifact: ArtifactSummary }) {
  const Icon = ICON[artifact.type] ?? FileText
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/50 p-3 my-2 max-w-sm">
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
        <Icon className="h-4.5 w-4.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{artifact.title}</p>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{artifact.type}</p>
      </div>
      {artifact.downloadUrl && (
        <a href={artifact.downloadUrl} target="_blank" rel="noreferrer"
          className={cn('flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity shrink-0')}>
          <Download className="h-3.5 w-3.5" /> Download
        </a>
      )}
    </div>
  )
})
