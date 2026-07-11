'use client'

import { memo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, X } from 'lucide-react'

interface DeleteConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onConfirm: () => void
}

export const DeleteConfirmDialog = memo(function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const handleConfirm = () => {
    onConfirm()
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 glass-panel rounded-xl p-6 w-full max-w-md shadow-2xl z-50 focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-200">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-full bg-red-500/20">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div className="flex-1">
              <Dialog.Title className="text-lg font-semibold">
                {title}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground mt-1">
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="p-1 rounded hover:bg-accent transition-colors">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Dialog.Close asChild>
              <button className="px-4 py-2 text-sm rounded-lg hover:bg-accent transition-colors">
                Cancel
              </button>
            </Dialog.Close>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
            >
              Delete
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
})
