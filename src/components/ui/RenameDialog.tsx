'use client'

import { memo, useRef, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Pencil, X } from 'lucide-react'

interface RenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentTitle: string
  onRename: (newTitle: string) => void
  title?: string
  placeholder?: string
}

export const RenameDialog = memo(function RenameDialog({
  open,
  onOpenChange,
  currentTitle,
  onRename,
  title = 'Rename Chat',
  placeholder = 'Enter chat title...',
}: RenameDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const trimmedTitle = inputRef.current?.value.trim()
    if (trimmedTitle && trimmedTitle !== currentTitle) {
      onRename(trimmedTitle)
    }
    onOpenChange(false)
  }, [currentTitle, onRename, onOpenChange])

  const handleOpenAutoFocus = useCallback((e: Event) => {
    e.preventDefault()
    // Select all text when dialog opens
    setTimeout(() => {
      inputRef.current?.select()
    }, 0)
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 glass-panel rounded-xl p-6 w-full max-w-md shadow-2xl z-50 focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-200"
          onOpenAutoFocus={handleOpenAutoFocus}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/20">
                <Pencil className="h-4 w-4 text-primary" />
              </div>
              <Dialog.Title className="text-lg font-semibold">
                {title}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="p-1 rounded hover:bg-accent transition-colors">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              key={currentTitle}
              defaultValue={currentTitle}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
              placeholder={placeholder}
            />

            <div className="flex justify-end gap-3 mt-4">
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
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
})
