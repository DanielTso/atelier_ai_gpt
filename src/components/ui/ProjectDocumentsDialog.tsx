'use client'

import { memo, useState, useEffect, useRef, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, FileText, Upload, Loader2, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { DocumentSummary } from '@/types'
import { useDocumentUpload } from '@/hooks/useDocumentUpload'
import { DocumentCard } from '@/components/chat/DocumentCard'
import { DocumentPreviewDialog } from '@/components/ui/DocumentPreviewDialog'
import { AddFromWebDialog } from '@/components/ui/AddFromWebDialog'

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
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [previewDoc, setPreviewDoc] = useState<DocumentSummary | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [webOpen, setWebOpen] = useState(false)

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

  const { upload, replace, uploading } = useDocumentUpload()
  const handleUpload = async (file: File) => {
    try {
      await upload(file, projectId)
      toast.success(`Uploaded and indexed: ${file.name}`)
      await loadDocuments()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    }
  }
  const handleReplace = async (docId: number, file: File) => {
    try {
      await replace(file, docId)
      toast.success(`Updated: ${file.name}`)
      await loadDocuments()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Replace failed')
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
            <Dialog.Close className="p-1 rounded hover:bg-accent transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Upload zone */}
          <div
            className={cn(
              "border-2 border-dashed rounded-xl p-6 mb-4 text-center transition-colors cursor-pointer",
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-border",
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
                  PDF, DOCX, images, text, and code files up to 200MB
                </p>
              </div>
            )}
          </div>

          <button
            onClick={() => setWebOpen(true)}
            className="mb-4 -mt-1 self-start flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Globe className="h-4 w-4" /> Add from web
          </button>

          {/* Document list */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
            ) : documents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No documents yet. Upload files to enable document-based context.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {documents.map(doc => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    onOpen={setPreviewDoc}
                    onDelete={(d) => handleDelete(d.id, d.filename)}
                    onReplace={(d, f) => handleReplace(d.id, f)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer summary */}
          {documents.length > 0 && (
            <div className="pt-3 mt-3 border-t border-border text-xs text-muted-foreground text-center">
              {totalChunks} chunk{totalChunks !== 1 ? 's' : ''} indexed across {readyDocs} document{readyDocs !== 1 ? 's' : ''}
            </div>
          )}
          <DocumentPreviewDialog
            open={previewDoc !== null}
            onOpenChange={(o) => { if (!o) setPreviewDoc(null) }}
            document={previewDoc}
          />
          <AddFromWebDialog
            open={webOpen}
            onOpenChange={setWebOpen}
            projectId={projectId}
            onIngested={loadDocuments}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
})
