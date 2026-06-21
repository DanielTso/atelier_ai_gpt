'use client'

import { Folder, Trash2 } from 'lucide-react'

interface ProjectsViewProps {
  projects: { id: number; name: string }[]
  onSelectProject: (id: number) => void
  onDeleteProject: (id: number) => void
}

export function ProjectsView({ projects, onSelectProject, onDeleteProject }: ProjectsViewProps) {
  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h2 className="text-2xl font-semibold text-foreground mb-6">Projects</h2>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {projects.map(p => (
            <div
              key={p.id}
              className="group glass-panel rounded-xl p-4 hover:bg-accent transition-colors flex items-center gap-3"
            >
              <button
                onClick={() => onSelectProject(p.id)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <Folder className="h-5 w-5 text-primary shrink-0" />
                <span className="font-medium text-foreground truncate">{p.name}</span>
              </button>
              <button
                onClick={() => onDeleteProject(p.id)}
                aria-label={`Delete project ${p.name}`}
                title="Delete project"
                className="shrink-0 p-1.5 rounded-lg text-muted-foreground opacity-60 hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
