'use client'

import { FolderPlus, Upload, PenLine, Code2 } from 'lucide-react'

interface QuickActionsProps {
  onNewProject: () => void
  onUpload: () => void
  onWrite: () => void
  onCode: () => void
}

export function QuickActions({ onNewProject, onUpload, onWrite, onCode }: QuickActionsProps) {
  const chips = [
    { label: 'New project', icon: FolderPlus, onClick: onNewProject },
    { label: 'Upload', icon: Upload, onClick: onUpload },
    { label: 'Write', icon: PenLine, onClick: onWrite },
    { label: 'Code', icon: Code2, onClick: onCode },
  ]
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
      {chips.map(({ label, icon: Icon, onClick }) => (
        <button
          key={label}
          onClick={onClick}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  )
}
