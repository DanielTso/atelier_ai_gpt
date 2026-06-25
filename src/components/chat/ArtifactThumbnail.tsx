'use client'
import { useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, FileType, FileText, Presentation, Code } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ArtifactSummary } from '@/types'
import type { SheetSpec } from '@/lib/artifacts/types'

const ICON: Record<string, LucideIcon> = { xlsx: FileSpreadsheet, docx: FileType, pdf: FileText, pptx: Presentation, html: Code }

function TypeTile({ type }: { type: string }) {
  const Icon = ICON[type] ?? FileText
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <Icon className="h-10 w-10 text-muted-foreground/50" />
    </div>
  )
}

function SheetsMini({ content }: { content: string | null | undefined }) {
  let sheet: SheetSpec | undefined
  try { sheet = (JSON.parse(content ?? '[]') as SheetSpec[])[0] } catch { sheet = undefined }
  if (!sheet?.rows?.length) return <TypeTile type="xlsx" />
  return (
    <div className="h-full w-full overflow-hidden bg-card p-2">
      <table className="w-full border-collapse text-[7px] leading-tight text-foreground">
        <tbody>
          {sheet.rows.slice(0, 8).map((row, i) => (
            <tr key={i}>
              {row.slice(0, 6).map((cell, j) => (
                <td key={j} className="truncate border border-border/50 px-1 py-0.5">{String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ArtifactThumbnail({ artifact }: { artifact: ArtifactSummary }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect() }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  return (
    <div ref={ref} className="relative aspect-[16/10] w-full overflow-hidden rounded-t-xl border-b border-border bg-muted">
      {!visible ? (
        <TypeTile type={artifact.type} />
      ) : artifact.type === 'html' && artifact.content ? (
        // Non-interactive scaled live render. No allow-same-origin → cannot reach app session.
        <iframe
          srcDoc={artifact.content}
          title={artifact.title}
          sandbox="allow-scripts"
          aria-hidden
          className="pointer-events-none h-[200%] w-[200%] origin-top-left scale-50 border-0 bg-white"
        />
      ) : artifact.type === 'pdf' && artifact.downloadUrl ? (
        <iframe
          src={`${artifact.downloadUrl}#toolbar=0&navpanes=0`}
          title={artifact.title}
          aria-hidden
          className="pointer-events-none h-full w-full border-0"
        />
      ) : artifact.type === 'xlsx' ? (
        <SheetsMini content={artifact.content} />
      ) : (artifact.type === 'docx' || artifact.type === 'pptx') && artifact.content ? (
        <div className="h-full w-full overflow-hidden bg-card p-3 text-[8px] leading-snug text-muted-foreground">
          {artifact.content.replace(/[#*_>`]/g, '').slice(0, 320)}
        </div>
      ) : (
        <TypeTile type={artifact.type} />
      )}
    </div>
  )
}
