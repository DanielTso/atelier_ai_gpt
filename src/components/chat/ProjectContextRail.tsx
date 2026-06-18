'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { FileText, Plus, Upload, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { DocumentSummary } from '@/types'
import { useDocumentUpload } from '@/hooks/useDocumentUpload'
import { DocumentCard } from '@/components/chat/DocumentCard'
import { DocumentPreviewDialog } from '@/components/ui/DocumentPreviewDialog'
import { CapacityBar } from '@/components/chat/CapacityBar'
import { PROJECT_CAPACITY_BYTES } from '@/lib/projectCapacity'

interface ProjectContextRailProps {
  project: { id: number; name: string; memory?: string | null; instructions?: string | null }
  onSaveContext: (id: number, fields: { memory?: string; instructions?: string }) => void
  onAddFiles: () => void
}

function useDebouncedSave(projectId: number, onSaveContext: ProjectContextRailProps['onSaveContext']) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback((fields: { memory?: string; instructions?: string }) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onSaveContext(projectId, fields), 600)
  }, [projectId, onSaveContext])
}

export function ProjectContextRail({ project, onSaveContext, onAddFiles }: ProjectContextRailProps) {
  const [memory, setMemory] = useState(project.memory ?? '')
  const [instructions, setInstructions] = useState(project.instructions ?? '')
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [previewDoc, setPreviewDoc] = useState<DocumentSummary | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saveMemory = useDebouncedSave(project.id, onSaveContext)
  const saveInstructions = useDebouncedSave(project.id, onSaveContext)

  // Note: the parent remounts this component via `key={project.id}`, so local
  // Memory/Instructions state initializes fresh per project — no reset effect needed.

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents?projectId=${project.id}`)
      if (res.ok) setDocuments((await res.json()).documents)
    } catch { /* silent */ }
  }, [project.id])
  useEffect(() => { loadDocuments() }, [loadDocuments])

  const { upload, uploading } = useDocumentUpload()
  const handleUpload = async (file: File) => {
    if (uploading) return
    try { await upload(file, project.id); toast.success(`Uploaded: ${file.name}`); await loadDocuments() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed') }
  }
  const handleDelete = async (docId: number) => {
    try {
      const res = await fetch(`/api/documents?id=${docId}`, { method: 'DELETE' })
      if (res.ok) { setDocuments(prev => prev.filter(d => d.id !== docId)); toast.success('Deleted') }
    } catch { toast.error('Failed to delete') }
  }
  const usedBytes = documents.reduce((sum, d) => sum + (d.fileSize ?? 0), 0)

  return (
    <aside className="w-(--rail-width) shrink-0 flex flex-col gap-4 overflow-y-auto border-l border-border/40 p-4">
      {/* Memory */}
      <section>
        <label htmlFor="rail-memory" className="text-sm font-semibold text-foreground">Memory</label>
        <textarea
          id="rail-memory" aria-label="Memory" value={memory}
          onChange={e => { setMemory(e.target.value); saveMemory({ memory: e.target.value }) }}
          placeholder="Purpose & context for this project…"
          className="mt-2 w-full min-h-20 resize-y rounded-lg border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </section>

      {/* Instructions */}
      <section>
        <label htmlFor="rail-instructions" className="text-sm font-semibold text-foreground">Instructions</label>
        <textarea
          id="rail-instructions" aria-label="Instructions" value={instructions}
          onChange={e => { setInstructions(e.target.value); saveInstructions({ instructions: e.target.value }) }}
          placeholder="How should Claude behave in this project?"
          className="mt-2 w-full min-h-20 resize-y rounded-lg border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </section>

      {/* Files */}
      <section className="flex-1">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" /> Files
          </h2>
          <button
            onClick={() => !uploading && fileInputRef.current?.click()} disabled={uploading}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors', uploading && 'opacity-50 cursor-not-allowed')}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} File
          </button>
        </div>
        <input
          ref={fileInputRef} type="file" className="hidden"
          accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.py,.js,.ts,.tsx,.jsx,.json,.html,.css,.java,.c,.cpp,.go,.rs,.rb,.php,.sh,.yaml,.yml,.xml,.sql,.png,.jpg,.jpeg,.webp"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }}
        />
        <div className="mb-3"><CapacityBar usedBytes={usedBytes} capBytes={PROJECT_CAPACITY_BYTES} /></div>
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Upload className="h-8 w-8 mb-3 opacity-30" />
            <p className="text-sm">No files yet</p>
            <button onClick={onAddFiles} className="text-xs mt-1.5 text-primary/80 hover:text-primary transition-colors">Upload documents for RAG</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {documents.map(doc => (
              <DocumentCard key={doc.id} doc={doc} onOpen={setPreviewDoc} onDelete={(d) => handleDelete(d.id)} />
            ))}
          </div>
        )}
      </section>

      <DocumentPreviewDialog open={previewDoc !== null} onOpenChange={(o) => { if (!o) setPreviewDoc(null) }} document={previewDoc} />
    </aside>
  )
}
