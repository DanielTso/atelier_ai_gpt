'use client'

import { FolderPlus, Upload, FileText, CalendarRange } from 'lucide-react'

interface QuickActionsProps {
  onNewProject: () => void
  onAddDocuments: () => void
  onDraftRfi: () => void
  onLookahead: () => void
}

export function QuickActions({ onNewProject, onAddDocuments, onDraftRfi, onLookahead }: QuickActionsProps) {
  // Chip config — construction-flavored starters. Swap/add here in one line.
  const chips = [
    { label: 'New project', icon: FolderPlus, onClick: onNewProject },
    { label: 'Add documents', icon: Upload, onClick: onAddDocuments },
    { label: 'Draft RFI', icon: FileText, onClick: onDraftRfi },
    { label: '3-week look-ahead', icon: CalendarRange, onClick: onLookahead },
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
