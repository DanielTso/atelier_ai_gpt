'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Download, Eye, Pencil, History, RotateCcw, Sparkles, Loader2, FileSpreadsheet, FileType, FileText, Presentation } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ArtifactSummary, ArtifactVersionSummary } from '@/types'
import { getArtifactVersions, restoreArtifactVersion } from '@/app/actions'
import { ArtifactPreview } from './ArtifactPreview'

const ICON: Record<string, LucideIcon> = { xlsx: FileSpreadsheet, docx: FileType, pdf: FileText, pptx: Presentation }
type Mode = 'preview' | 'edit' | 'versions'

export function ArtifactWorkspace({ artifact, onClose, onChanged }: {
  artifact: ArtifactSummary
  onClose: () => void
  onChanged: () => void
}) {
  const Icon = ICON[artifact.type] ?? FileText
  const [mode, setMode] = useState<Mode>('preview')
  const [editText, setEditText] = useState(artifact.content ?? '')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [versions, setVersions] = useState<ArtifactVersionSummary[]>([])

  // Reset local edit buffer whenever the underlying artifact changes (id or a new
  // version's content), so the editor reflects the current source.
  useEffect(() => { setEditText(artifact.content ?? ''); setMode('preview') }, [artifact.id, artifact.content])

  const loadVersions = useCallback(async () => {
    try { setVersions((await getArtifactVersions(artifact.id)) as ArtifactVersionSummary[]) } catch { /* silent */ }
  }, [artifact.id])
  useEffect(() => { if (mode === 'versions') loadVersions() }, [mode, loadVersions])

  async function saveEdit() {
    setBusy(true)
    try {
      let content: unknown = editText
      if (artifact.format === 'sheets') {
        try { content = JSON.parse(editText) } catch { toast.error('Sheet data must be valid JSON'); return }
      }
      const res = await fetch(`/api/artifacts/${artifact.id}/edit`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error()
      toast.success('Saved as a new version'); onChanged(); setMode('preview')
    } catch { toast.error('Failed to save') } finally { setBusy(false) }
  }

  async function regenerate() {
    if (!instruction.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}/regenerate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction }),
      })
      if (!res.ok) throw new Error()
      toast.success('Regenerated as a new version'); setInstruction(''); onChanged()
    } catch { toast.error('Failed to regenerate') } finally { setBusy(false) }
  }

  async function restore(version: number) {
    setBusy(true)
    try { await restoreArtifactVersion(artifact.id, version); toast.success(`Restored v${version}`); onChanged() }
    catch { toast.error('Failed to restore') } finally { setBusy(false) }
  }

  const tab = (m: Mode, label: string, TabIcon: LucideIcon) => (
    <button
      onClick={() => setMode(m)}
      className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors',
        mode === m ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/60')}
    >
      <TabIcon className="h-3.5 w-3.5" /> {label}
    </button>
  )

  return (
    <aside className="flex w-(--artifact-panel-width) shrink-0 flex-col overflow-hidden border-l border-border/40">
      <div className="flex items-start justify-between gap-2 p-4 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{artifact.title}</p>
            <p className="text-xs text-muted-foreground">{artifact.type.toUpperCase()}{artifact.version ? ` · v${artifact.version}` : ''}</p>
          </div>
        </div>
        <button onClick={onClose} title="Close" aria-label="Close artifact" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-1 px-4 pb-2">
        {tab('preview', 'Preview', Eye)}
        {tab('edit', 'Edit', Pencil)}
        {tab('versions', 'Versions', History)}
        {artifact.downloadUrl && (
          <a href={artifact.downloadUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {mode === 'preview' && <ArtifactPreview artifact={artifact} />}

        {mode === 'edit' && (
          <div className="flex h-full flex-col gap-2 pb-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
              Edit source ({artifact.format === 'sheets' ? 'JSON sheets' : 'Markdown'}) — saving creates a new version
            </p>
            <textarea
              aria-label="Edit source"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="min-h-60 flex-1 resize-none rounded-lg border border-border bg-background p-2.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save version
              </button>
              <button onClick={() => { setEditText(artifact.content ?? ''); setMode('preview') }} className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent">
                Cancel
              </button>
            </div>
          </div>
        )}

        {mode === 'versions' && (
          <div className="space-y-1.5 pb-2">
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No versions yet.</p>
            ) : versions.map((v) => (
              <div key={v.id} className={cn('flex items-center gap-2 rounded-lg border p-2 text-xs',
                v.version === artifact.version ? 'border-primary/40 bg-primary/5' : 'border-border/60')}>
                <span className="font-medium text-foreground">v{v.version}</span>
                <span className="truncate text-muted-foreground">{v.title}</span>
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  {v.downloadUrl && (
                    <a href={v.downloadUrl} target="_blank" rel="noopener noreferrer" title="Download this version" className="rounded p-1 text-muted-foreground hover:text-foreground">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {v.version !== artifact.version && (
                    <button onClick={() => restore(v.version)} disabled={busy} title="Restore this version" className="rounded p-1 text-muted-foreground hover:text-primary disabled:opacity-50">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Regenerate (Claude) — always available */}
      <div className="border-t border-border/40 p-3">
        <div className="flex items-center gap-2">
          <input
            aria-label="Regenerate instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) regenerate() }}
            placeholder="Ask Claude to revise…"
            className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button onClick={regenerate} disabled={busy || !instruction.trim()} title="Regenerate" className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Revise
          </button>
        </div>
      </div>
    </aside>
  )
}
