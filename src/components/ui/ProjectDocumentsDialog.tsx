'use client'

import { memo, useState, useEffect, useRef, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, FileText, Upload, Trash2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatFileSize, getFileTypeBadge } from '@/lib/fileUtils'
import { toast } from 'sonner'

interface Document {
  id: number
  filename: string
  mimeType: string
  fileSize: number
  charCount: number
  chunkCount: number | null
  status: string
  errorMessage: string | null
  createdAt: Date | null
}

interface ProjectDocumentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  projectName: string
}

export const ProjectDocumentsDialog = memo(function ProjectDocumentsDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: ProjectDocumentsDialogProps) {
  const [documents, setDocuments] = useState<Document[]>([])
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents?projectId=${projectId}`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.documents)
      }
    } catch {
      // Silently fail, user can refresh
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) {
      setLoading(true)
      loadDocuments()
    }
  }, [open, loadDocuments])

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      // 1. Mint a signed upload URL + create the documents row.
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size }),
      })
      if (!urlRes.ok) throw new Error((await urlRes.json()).error || 'Upload failed')
      const { documentId, path, token, bucket } = await urlRes.json()

      // 2. Upload the bytes straight to Storage (bypasses the function body limit).
      const { getBrowserSupabase } = await import('@/lib/storageClient')
      const { error: upErr } = await getBrowserSupabase().storage.from(bucket).uploadToSignedUrl(path, token, file)
      if (upErr) throw upErr

      // 3. Kick off server-side processing.
      const procRes = await fetch('/api/documents/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      if (!procRes.ok) throw new Error((await procRes.json()).error || 'Processing failed')

      toast.success(`Uploaded and indexed: ${file.name}`)
      await loadDocuments()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed'
      toast.error(message)
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    // Reset so the same file can be uploaded again
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleUpload(file)
  }

  const handleDelete = async (docId: number, filename: string) => {
    try {
      const res = await fetch(`/api/documents?id=${docId}`, { method: 'DELETE' })
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== docId))
        toast.success(`Deleted: ${filename}`)
      }
    } catch {
      toast.error('Failed to delete document')
    }
  }

  const totalChunks = documents.reduce((sum, d) => sum + (d.chunkCount ?? 0), 0)
  const readyDocs = documents.filter(d => d.status === 'ready').length

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg glass-panel rounded-2xl p-6 z-50 shadow-xl max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-400" />
              Documents — {projectName}
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-white/10 transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Upload zone */}
          <div
            className={cn(
              "border-2 border-dashed rounded-xl p-6 mb-4 text-center transition-colors cursor-pointer",
              dragOver ? "border-primary bg-primary/5" : "border-white/10 hover:border-white/20",
              uploading && "opacity-50 pointer-events-none"
            )}
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.py,.js,.ts,.tsx,.jsx,.json,.html,.css,.java,.c,.cpp,.go,.rs,.rb,.php,.sh,.yaml,.yml,.xml,.sql,.png,.jpg,.jpeg,.webp"
              onChange={handleFileChange}
            />
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Processing document...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Drop a file here or click to upload
                </p>
                <p className="text-xs text-muted-foreground/60">
                  PDF, DOCX, images, text, and code files up to 50MB
                </p>
              </div>
            )}
          </div>

          {/* Document list */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
            ) : documents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No documents yet. Upload files to enable document-based context.
              </div>
            ) : (
              documents.map(doc => {
                const badge = getFileTypeBadge(doc.mimeType, doc.filename)
                return (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors group"
                  >
                    {/* Status icon */}
                    <div className="shrink-0">
                      {doc.status === 'processing' && <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />}
                      {doc.status === 'ready' && <CheckCircle2 className="h-4 w-4 text-green-400" />}
                      {doc.status === 'error' && <AlertCircle className="h-4 w-4 text-red-400" />}
                    </div>

                    {/* File info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm truncate">{doc.filename}</span>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full shrink-0", badge.className)}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>{formatFileSize(doc.fileSize)}</span>
                        {doc.status === 'ready' && (
                          <span>{doc.chunkCount} chunk{doc.chunkCount !== 1 ? 's' : ''}</span>
                        )}
                        {doc.status === 'error' && (
                          <span className="text-red-400 truncate">{doc.errorMessage || 'Processing failed'}</span>
                        )}
                      </div>
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={() => handleDelete(doc.id, doc.filename)}
                      className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                      title="Delete document"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* Footer summary */}
          {documents.length > 0 && (
            <div className="pt-3 mt-3 border-t border-white/5 text-xs text-muted-foreground text-center">
              {totalChunks} chunk{totalChunks !== 1 ? 's' : ''} indexed across {readyDocs} document{readyDocs !== 1 ? 's' : ''}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
})
