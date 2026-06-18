'use client'

import { Folder } from 'lucide-react'

interface ProjectsViewProps {
  projects: { id: number; name: string }[]
  onSelectProject: (id: number) => void
}

export function ProjectsView({ projects, onSelectProject }: ProjectsViewProps) {
  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h2 className="text-2xl font-semibold text-foreground mb-6">Projects</h2>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => onSelectProject(p.id)}
              className="glass-panel rounded-xl p-4 text-left hover:bg-accent transition-colors flex items-center gap-3"
            >
              <Folder className="h-5 w-5 text-primary shrink-0" />
              <span className="font-medium text-foreground truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
