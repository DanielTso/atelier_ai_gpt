'use client'

import { memo, useRef, useState, useEffect, useCallback } from 'react'
import { Send, Square, Loader2, FileText, Brain, Paperclip, Upload, X, BookMarked } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import TextareaAutosize from 'react-textarea-autosize'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { PersonaSelector } from '@/components/ui/PersonaSelector'
import { EffortPill } from '@/components/ui/EffortPill'
import { ModelSelect } from '@/components/ui/ModelSelect'
import type { Effort } from '@/hooks/usePersonas'
import type { AttachedFile, AttachedImage } from '@/lib/fileAttachments'
import { getFileTypeLabel, isImageFile, fileToAttachedImage } from '@/lib/fileAttachments'
import { formatFileSize } from '@/lib/fileUtils'
import type { Model } from '@/types'

interface EmbedStatus {
  available: boolean
  provider: 'gemini' | null
  embeddingCount: number
}

// Effort ladder order — used only to clamp a persisted effort value down to a
// level the currently selected model actually supports (see clampEffort).
const EFFORT_ORDER: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * A chat can carry an effort value picked under a DIFFERENT model (e.g. `xhigh`
 * chosen while on Fable 5, then the user switches to a model whose capabilities
 * don't include it) — EffortPill must never DISPLAY a selected value that can't
 * actually be sent. This only clamps the display: the server independently
 * strips an unsupported effort before it reaches the provider (providers.ts),
 * so this is cosmetic, not a correctness fix.
 * - No value chosen yet: leave it alone (nothing to clamp).
 * - Value still supported: pass through unchanged.
 * - Otherwise: the highest supported level at or below the requested one, or
 *   the model's own top level if nothing qualifies (requested value is below
 *   everything the model supports).
 */
function clampEffort(value: Effort | undefined, levels: Effort[]): Effort | undefined {
  if (!value || levels.length === 0 || levels.includes(value)) return value
  const valueRank = EFFORT_ORDER.indexOf(value)
  const atOrBelow = levels.filter(l => EFFORT_ORDER.indexOf(l) <= valueRank)
  const pool = atOrBelow.length > 0 ? atOrBelow : levels
  return pool.reduce((best, l) => (EFFORT_ORDER.indexOf(l) > EFFORT_ORDER.indexOf(best) ? l : best))
}

interface ChatInputAreaProps {
  input: string
  onInputChange: (value: string) => void
  onFormSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  isLoading: boolean
  /** Cancels the in-flight response — the send button morphs into stop while streaming. */
  onStop?: () => void
  /** Gate for the stop morph: true only while tokens stream. During 'submitted' the
      button stays a disabled spinner so a double-click can't abort the just-sent turn. */
  canStop?: boolean
  activeChatId: number | null
  activeProjectId: number | null
  systemPrompt: string | null
  onSystemPromptChange: (prompt: string | null) => void
  onSystemPromptClick: () => void
  models?: Model[]
  selectedModel?: string
  onModelChange?: (model: string) => void
  selectedEffort?: Effort
  onEffortChange?: (effort?: Effort) => void
  /** Grounded answers: restrict Claude to project documents + require citations.
   *  The OFF-state pill only renders in a project context (showGroundedPill),
   *  but an ON state always renders — it must stay visible and dismissable
   *  even outside project context (review F2 safety valve). */
  grounded?: boolean
  onGroundedToggle?: () => void
  showGroundedPill?: boolean
  attachedFiles: AttachedFile[]
  onFilesChange: (files: AttachedFile[]) => void
  attachedImages: AttachedImage[]
  onImagesChange: (images: AttachedImage[]) => void
}

export const ChatInputArea = memo(function ChatInputArea({
  input,
  onInputChange,
  onFormSubmit,
  onKeyDown,
  isLoading,
  onStop,
  canStop = false,
  activeChatId,
  activeProjectId,
  systemPrompt,
  onSystemPromptChange,
  onSystemPromptClick,
  models,
  selectedModel,
  onModelChange,
  selectedEffort,
  onEffortChange,
  grounded = false,
  onGroundedToggle,
  showGroundedPill = false,
  attachedFiles,
  onFilesChange,
  attachedImages,
  onImagesChange,
}: ChatInputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [embedStatus, setEmbedStatus] = useState<EmbedStatus | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)

  // Track when loading state changes to detect response completion
  const prevLoading = useRef(isLoading)

  // Check embedding status when chat/project changes, or after a response completes
  useEffect(() => {
    const wasLoading = prevLoading.current
    prevLoading.current = isLoading

    // Refresh on: chat change, or response just finished (wasLoading && !isLoading)
    const responseJustFinished = wasLoading && !isLoading

    if (!activeChatId) {
      setEmbedStatus(null)
      return
    }

    // On initial chat load or after response, fetch status
    // After response, add a delay to let async embed calls complete
    const delay = responseJustFinished ? 3000 : 0
    const timer = setTimeout(() => {
      const params = new URLSearchParams()
      if (activeProjectId) params.set('projectId', String(activeProjectId))
      else params.set('chatId', String(activeChatId))

      fetch(`/api/embed?${params}`)
        .then(r => r.json())
        .then(setEmbedStatus)
        .catch(() => setEmbedStatus(null))
    }, delay)

    return () => clearTimeout(timer)
  }, [activeChatId, activeProjectId, isLoading])

  const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

  const processFiles = useCallback(async (files: File[]) => {
    const imageFiles: File[] = []
    const textFiles: File[] = []

    for (const file of files) {
      if (isImageFile(file)) {
        if (file.size > MAX_IMAGE_SIZE) {
          toast.error(`${file.name} exceeds 10MB limit`)
          continue
        }
        imageFiles.push(file)
      } else {
        textFiles.push(file)
      }
    }

    // Process images client-side (no server call needed)
    if (imageFiles.length > 0) {
      const newImages: AttachedImage[] = []
      for (const file of imageFiles) {
        try {
          const img = await fileToAttachedImage(file)
          newImages.push(img)
        } catch {
          toast.error(`Failed to read ${file.name}`)
        }
      }
      if (newImages.length > 0) {
        onImagesChange([...attachedImages, ...newImages])
      }
    }

    // Process text files via server extraction
    if (textFiles.length > 0) {
      setIsExtracting(true)
      const results: AttachedFile[] = []

      for (const file of textFiles) {
        try {
          const formData = new FormData()
          formData.append('file', file)

          const res = await fetch('/api/extract', { method: 'POST', body: formData })
          if (!res.ok) {
            const data = await res.json()
            toast.error(data.error || `Failed to process ${file.name}`)
            continue
          }

          const data = await res.json()
          results.push({
            name: data.filename,
            type: data.mimeType,
            size: file.size,
            charCount: data.charCount,
            textContent: data.textContent,
            truncated: data.truncated,
          })
        } catch {
          toast.error(`Failed to process ${file.name}`)
        }
      }

      if (results.length > 0) {
        onFilesChange([...attachedFiles, ...results])
      }
      setIsExtracting(false)
    }
  }, [attachedFiles, onFilesChange, attachedImages, onImagesChange])

  // Prevent the browser's default "open the dropped file" behaviour anywhere on
  // the window. Without this, a file dropped even slightly outside the input area
  // makes the browser navigate to / download the file instead of attaching it.
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) {
        e.preventDefault()
      }
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  // Depth counter so isDragOver only toggles when the drag truly enters/leaves
  // the container — not every time it crosses a child element (textarea, buttons),
  // which otherwise causes the overlay to flicker on/off rapidly.
  const dragDepth = useRef(0)

  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('Files')

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    setIsDragOver(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      processFiles(files)
    }
  }, [processFiles])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) {
      processFiles(files)
    }
    // Reset input so the same file can be re-selected
    e.target.value = ''
  }, [processFiles])

  const removeFile = useCallback((index: number) => {
    onFilesChange(attachedFiles.filter((_, i) => i !== index))
  }, [attachedFiles, onFilesChange])

  const removeImage = useCallback((index: number) => {
    onImagesChange(attachedImages.filter((_, i) => i !== index))
  }, [attachedImages, onImagesChange])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter(item => item.type.startsWith('image/'))
    if (imageItems.length === 0) return

    e.preventDefault()
    const files = imageItems
      .map(item => item.getAsFile())
      .filter((f): f is File => f !== null)
    if (files.length > 0) {
      processFiles(files)
    }
  }, [processFiles])

  const hasFiles = attachedFiles.length > 0
  const hasImages = attachedImages.length > 0

  // Look up the selected model's capabilities in the already-fetched `models`
  // list (no per-request network call) to gate the effort pill. A model not
  // (yet) found in the list — models still loading, or a stale selection —
  // renders no pill rather than guessing.
  const selectedModelCaps = models?.find(m => m.model === selectedModel)?.capabilities

  return (
    <div
      className="p-4 border-t border-border/40 relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay — pointer-events-none so it never becomes a drag target
          itself, which would steal events from the container and cause flicker. */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/50 rounded-lg backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="h-8 w-8" />
            <span className="text-sm font-medium">Drop files here</span>
          </div>
        </div>
      )}

      <div className="max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto">
        {/* Toolbar row with Model, PersonaSelector, System Prompt, and Attach */}
        <div className="flex items-center gap-2 mb-2 px-1">
          {models && selectedModel && onModelChange && (
            <ModelSelect
              models={models}
              value={selectedModel}
              onChange={onModelChange}
            />
          )}
          <PersonaSelector
            currentPrompt={systemPrompt}
            onSelect={onSystemPromptChange}
            onCustomize={onSystemPromptClick}
            onModelChange={onModelChange}
            onEffortChange={onEffortChange}
            disabled={false}
            side="top"
          />
          {onEffortChange && selectedModelCaps?.supportsEffort && (
            <EffortPill
              value={clampEffort(selectedEffort, selectedModelCaps.effortLevels)}
              levels={selectedModelCaps.effortLevels}
              onChange={onEffortChange}
              side="top"
            />
          )}
          {(showGroundedPill || grounded) && onGroundedToggle && (
            <button
              type="button"
              onClick={onGroundedToggle}
              aria-pressed={grounded}
              title={grounded
                ? 'Grounded: answers restricted to project documents with citations'
                : 'Grounded answers off — click to restrict to project documents'}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors',
                grounded
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              <BookMarked className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Grounded</span>
            </button>
          )}
          <button
            onClick={onSystemPromptClick}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Edit system prompt"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">System Prompt</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            title="Attach to this message"
          >
            <Paperclip className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Attach</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.py,.js,.ts,.tsx,.jsx,.json,.html,.css,.java,.c,.cpp,.go,.rs,.rb,.php,.sh,.yaml,.yml,.xml,.sql,.png,.jpg,.jpeg,.gif,.webp,image/*"
            onChange={handleFileInputChange}
          />

          {/* Semantic memory status indicator */}
          {embedStatus && (
            <div
              className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-muted-foreground"
              title={embedStatus.available
                ? `Semantic memory active via Gemini — ${embedStatus.embeddingCount} embeddings stored`
                : 'Semantic memory offline — configure Gemini API key'}
            >
              <Brain className={`h-3.5 w-3.5 ${embedStatus.available ? 'text-emerald-400' : 'text-muted-foreground/50'}`} />
              <span className="hidden sm:inline">
                {embedStatus.available
                  ? `${embedStatus.embeddingCount} memories (Gemini)`
                  : 'Memory off'}
              </span>
            </div>
          )}
        </div>

        {/* Attached image thumbnails */}
        {hasImages && (
          <div className="flex flex-wrap gap-2 mb-2 px-1">
            {attachedImages.map((img, index) => (
              <div
                key={`img-${img.name}-${index}`}
                className="relative group/thumb w-20 h-20 rounded-lg overflow-hidden border border-border bg-muted"
              >
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5">
                  <span className="text-[10px] text-foreground truncate block">{img.name}</span>
                </div>
                <button
                  onClick={() => removeImage(index)}
                  className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                  title="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Attached files chips */}
        {(hasFiles || isExtracting) && (
          <div className="flex flex-wrap gap-2 mb-2 px-1">
            {attachedFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-xs"
              >
                <Paperclip className="h-3 w-3 text-primary/70" />
                <span className="font-medium truncate max-w-[150px]">{file.name}</span>
                <span className="text-muted-foreground">
                  {getFileTypeLabel(file.type, file.name)} · {formatFileSize(file.size)}
                </span>
                {file.truncated && (
                  <span className="text-amber-400" title="File was truncated to 100K characters">
                    (truncated)
                  </span>
                )}
                <button
                  onClick={() => removeFile(index)}
                  className="ml-0.5 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Remove file"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {isExtracting && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted border border-border text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Extracting...</span>
              </div>
            )}
          </div>
        )}

        {/* Input form */}
        <form onSubmit={onFormSubmit} className="relative">
          <TextareaAutosize
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={handlePaste}
            disabled={isLoading}
            minRows={2}
            maxRows={6}
            className="w-full bg-card border border-border rounded-2xl px-5 py-4 pr-14 shadow-sm focus:outline-none focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_30%,transparent)] transition-all placeholder:text-muted-foreground disabled:opacity-50 resize-none"
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          />
          {(() => {
            // One condition drives type/click/label/disabled/icon so they can't drift.
            const showStop = isLoading && canStop && !!onStop
            const icon = showStop
              ? { key: 'stop', node: <Square className="h-4 w-4 fill-current" /> }
              : isLoading
                ? { key: 'wait', node: <Loader2 className="h-4 w-4 animate-spin" /> }
                : { key: 'send', node: <Send className="h-4 w-4" /> }
            return (
              <button
                type={showStop ? 'button' : 'submit'}
                onClick={showStop ? onStop : undefined}
                aria-label={showStop ? 'Stop response' : 'Send message'}
                disabled={isLoading ? !showStop : (!input?.trim() && !hasFiles && !hasImages)}
                className="absolute right-3 bottom-3 p-2 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50 active:scale-[0.94] motion-safe:transition-[transform,background-color]"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={icon.key}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="block"
                  >
                    {icon.node}
                  </motion.span>
                </AnimatePresence>
              </button>
            )
          })()}
        </form>
        <div className="text-center mt-2">
          <p className="text-xs text-muted-foreground">AI can make mistakes. Check important info.</p>
        </div>
      </div>
    </div>
  )
})
