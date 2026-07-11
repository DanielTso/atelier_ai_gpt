'use client'

import { memo, useRef, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { DIALOG_OVERLAY_ANIM, DIALOG_CONTENT_ANIM } from '@/lib/motion'
import { Bot, X } from 'lucide-react'

interface SystemPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPrompt: string | null
  onSave: (prompt: string | null) => void
}

const PROMPT_EXAMPLES = [
  "You are a helpful coding assistant specializing in React and TypeScript.",
  "You are a friendly tutor who explains concepts simply and encourages learning.",
  "You are a technical writer who creates clear, concise documentation.",
  "You are a code reviewer focused on best practices and security.",
]

export const SystemPromptDialog = memo(function SystemPromptDialog({
  open,
  onOpenChange,
  currentPrompt,
  onSave,
}: SystemPromptDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const value = textareaRef.current?.value.trim()
    onSave(value || null)
    onOpenChange(false)
  }, [onSave, onOpenChange])

  const handleClear = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.value = ''
    }
    onSave(null)
    onOpenChange(false)
  }, [onSave, onOpenChange])

  const handleExampleClick = useCallback((example: string) => {
    if (textareaRef.current) {
      textareaRef.current.value = example
      textareaRef.current.focus()
    }
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-50 ${DIALOG_OVERLAY_ANIM}`} />
        <Dialog.Content className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 glass-panel rounded-xl p-6 w-full max-w-lg shadow-2xl z-50 focus:outline-none max-h-[85vh] overflow-y-auto ${DIALOG_CONTENT_ANIM}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/20">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div>
                <Dialog.Title className="text-lg font-semibold">
                  System Instruction
                </Dialog.Title>
                <Dialog.Description className="text-xs text-muted-foreground">
                  Define the AI&apos;s personality and behavior for this chat
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button className="p-1 rounded hover:bg-accent transition-colors">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              defaultValue={currentPrompt || ''}
              rows={5}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all resize-none"
              placeholder="e.g., You are a helpful coding assistant..."
            />

            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-2">Quick examples:</p>
              <div className="flex flex-wrap gap-2">
                {PROMPT_EXAMPLES.map((example, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleExampleClick(example)}
                    className="text-xs px-2 py-1 rounded bg-muted hover:bg-accent text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]"
                  >
                    {example.substring(0, 40)}...
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-between gap-3 mt-4">
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-2 text-sm rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Clear
              </button>
              <div className="flex gap-3">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="px-4 py-2 text-sm rounded-lg hover:bg-accent transition-colors"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </form>

          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground">
              The system instruction defines the AI&apos;s role and behavior. It&apos;s always included in every message and never trimmed during context management.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
})
