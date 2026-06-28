'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { FileText, Plus, Upload, Loader2, Check, X, Pencil, Sparkles, Globe, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { DocumentSummary, MemorySuggestion } from '@/types'
import { getPendingSuggestions, acceptSuggestion, dismissSuggestion } from '@/app/actions'
import { useDocumentUpload } from '@/hooks/useDocumentUpload'
import { DocumentCard } from '@/components/chat/DocumentCard'
import { DocumentPreviewDialog } from '@/components/ui/DocumentPreviewDialog'
import { AddFromWebDialog } from '@/components/ui/AddFromWebDialog'
import { CapacityBar } from '@/components/chat/CapacityBar'
import { PROJECT_CAPACITY_BYTES } from '@/lib/projectCapacity'
import { useLocalStorage } from '@/hooks/useLocalStorage'

// Resizable context rail: drag the left edge to resize, double-click to reset,
// collapse to a thin strip. Width + collapsed state persist in localStorage.
const DEFAULT_RAIL_WIDTH = 320
const MIN_RAIL_WIDTH = 280

interface ProjectContextRailProps {
  project: { id: number; name: string; memory?: string | null; instructions?: string | null }
  onSaveContext: (id: number, fields: { memory?: string; instructions?: string }) => void
  onAddFiles: () => void
}

function useDebouncedSave(projectId: number, onSaveContext: ProjectContextRailProps['onSaveContext']) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = useCallback((fields: { memory?: string; instructions?: string }) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onSaveContext(projectId, fields), 600)
  }, [projectId, onSaveContext])
  const cancel = useCallback(() => { if (timer.current) clearTimeout(timer.current) }, [])
  return { save, cancel }
}

export function ProjectContextRail({ project, onSaveContext, onAddFiles }: ProjectContextRailProps) {
  const [memory, setMemory] = useState(project.memory ?? '')
  const [instructions, setInstructions] = useState(project.instructions ?? '')
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [previewDoc, setPreviewDoc] = useState<DocumentSummary | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [webOpen, setWebOpen] = useState(false)
  const [railWidth, setRailWidth] = useLocalStorage('project-rail-width', DEFAULT_RAIL_WIDTH, (v) => typeof v === 'number' && v >= 240 && v <= 1000)
  const [collapsed, setCollapsed] = useLocalStorage('project-rail-collapsed', false, (v) => typeof v === 'boolean')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { save: saveMemory, cancel: cancelMemorySave } = useDebouncedSave(project.id, onSaveContext)
  const { save: saveInstructions } = useDebouncedSave(project.id, onSaveContext)

  // Note: the parent remounts this component via `key={project.id}`, so local
  // Memory/Instructions state initializes fresh per project — no reset effect needed.

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents?projectId=${project.id}`)
      if (res.ok) setDocuments((await res.json()).documents)
    } catch { /* silent */ }
  }, [project.id])
  useEffect(() => { loadDocuments() }, [loadDocuments])

  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  const loadSuggestions = useCallback(async () => {
    try {
      const rows = await getPendingSuggestions(project.id)
      setSuggestions(rows.map(r => ({ id: r.id, text: r.text, createdAt: r.createdAt })))
    } catch { /* silent */ }
  }, [project.id])
  useEffect(() => { loadSuggestions() }, [loadSuggestions])

  const handleAccept = async (id: number, text?: string) => {
    try {
      const res = await acceptSuggestion(id, text)
      if (res) {
        // Cancel any pending debounced textarea save so it can't replay stale
        // content over the server-appended value we just received.
        cancelMemorySave()
        setMemory(res.memory)
      }
      setSuggestions(prev => prev.filter(s => s.id !== id))
      setEditingId(null)
      toast.success('Added to memory')
    } catch { toast.error('Failed to accept') }
  }
  const handleDismiss = async (id: number) => {
    try {
      await dismissSuggestion(id)
      setSuggestions(prev => prev.filter(s => s.id !== id))
    } catch { toast.error('Failed to dismiss') }
  }

  const { upload, replace, uploading } = useDocumentUpload()
  // Upload one or more files sequentially (drag-drop can yield several), then refresh once.
  const handleFiles = async (files: File[]) => {
    if (uploading || files.length === 0) return
    for (const file of files) {
      try { await upload(file, project.id); toast.success(`Uploaded: ${file.name}`) }
      catch (e) { toast.error(e instanceof Error ? e.message : `Upload failed: ${file.name}`) }
    }
    await loadDocuments()
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) handleFiles(files)
  }
  const handleReplace = async (docId: number, file: File) => {
    if (uploading) return
    try { await replace(file, docId); toast.success(`Updated: ${file.name}`); await loadDocuments() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Replace failed') }
  }
  const handleDelete = async (docId: number) => {
    try {
      const res = await fetch(`/api/documents?id=${docId}`, { method: 'DELETE' })
      if (res.ok) { setDocuments(prev => prev.filter(d => d.id !== docId)); toast.success('Deleted') }
    } catch { toast.error('Failed to delete') }
  }
  const usedBytes = documents.reduce((sum, d) => sum + (d.fileSize ?? 0), 0)

  // Drag the left edge to resize; width is clamped (min..50vw, capped 640) and persisted.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = railWidth
    const maxW = Math.min(640, Math.round(window.innerWidth * 0.5))
    const onMove = (ev: PointerEvent) =>
      setRailWidth(Math.min(Math.max(startW - (ev.clientX - startX), MIN_RAIL_WIDTH), maxW))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (collapsed) {
    return (
      <aside className="w-10 shrink-0 my-3 mr-3 flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/40 py-3">
        <button
          onClick={() => setCollapsed(false)}
          title="Expand panel" aria-label="Expand project panel"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
        <FileText className="h-4 w-4 text-muted-foreground/40" />
      </aside>
    )
  }

  return (
    <aside style={{ width: railWidth }} className="relative shrink-0 my-3 mr-3 overflow-hidden rounded-xl border border-border/60 bg-card/40">
      {/* Drag-to-resize handle on the left edge */}
      <div
        onPointerDown={startResize}
        onDoubleClick={() => setRailWidth(DEFAULT_RAIL_WIDTH)}
        title="Drag to resize · double-click to reset"
        className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40"
      />
      <div className="h-full flex flex-col gap-4 overflow-y-auto p-4">
        <div className="flex justify-end -mb-2 -mt-1">
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse panel" aria-label="Collapse project panel"
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      {/* Memory */}
      <section>
        <label htmlFor="rail-memory" className="text-sm font-semibold text-foreground">Memory</label>
        <textarea
          id="rail-memory" aria-label="Memory" value={memory}
          onChange={e => { setMemory(e.target.value); saveMemory({ memory: e.target.value }) }}
          placeholder="Purpose & context for this project…"
          className="mt-2 w-full min-h-20 resize-y rounded-lg border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {suggestions.length > 0 && (
          <div className="mt-2 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Suggested memories ({suggestions.length})
            </p>
            {suggestions.map(s => (
              <div key={s.id} className="flex items-start gap-1.5 rounded-lg border border-border/60 bg-muted/30 p-2 text-xs">
                {editingId === s.id ? (
                  <input
                    aria-label="Edit suggestion" value={editText}
                    onChange={e => setEditText(e.target.value)}
                    className="flex-1 rounded border border-border bg-background px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <span className="flex-1 text-foreground">{s.text}</span>
                )}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => handleAccept(s.id, editingId === s.id ? editText : undefined)} title="Accept" className="p-1 rounded text-muted-foreground hover:text-success"><Check className="h-3.5 w-3.5" /></button>
                  {editingId !== s.id && (
                    <button onClick={() => { setEditingId(s.id); setEditText(s.text) }} title="Edit" className="p-1 rounded text-muted-foreground hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                  )}
                  <button onClick={() => handleDismiss(s.id)} title="Dismiss" className="p-1 rounded text-muted-foreground hover:text-red-400"><X className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
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
      <section
        className={cn('flex-1 relative rounded-lg transition-colors', dragOver && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
        onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5">
            <p className="flex items-center gap-2 text-sm font-medium text-primary">
              <Upload className="h-4 w-4" /> Drop files to upload
            </p>
          </div>
        )}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" /> Files
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setWebOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Globe className="h-3.5 w-3.5" /> Web
            </button>
            <button
              onClick={() => !uploading && fileInputRef.current?.click()} disabled={uploading}
              className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors', uploading && 'opacity-50 cursor-not-allowed')}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} File
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef} type="file" multiple className="hidden"
          accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.py,.js,.ts,.tsx,.jsx,.json,.html,.css,.java,.c,.cpp,.go,.rs,.rb,.php,.sh,.yaml,.yml,.xml,.sql,.png,.jpg,.jpeg,.webp"
          onChange={e => { handleFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
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
              <DocumentCard key={doc.id} doc={doc} onOpen={setPreviewDoc} onDelete={(d) => handleDelete(d.id)} onReplace={(d, f) => handleReplace(d.id, f)} />
            ))}
          </div>
        )}
      </section>

      <DocumentPreviewDialog open={previewDoc !== null} onOpenChange={(o) => { if (!o) setPreviewDoc(null) }} document={previewDoc} />
      <AddFromWebDialog open={webOpen} onOpenChange={setWebOpen} projectId={project.id} onIngested={loadDocuments} />
      </div>
    </aside>
  )
}
