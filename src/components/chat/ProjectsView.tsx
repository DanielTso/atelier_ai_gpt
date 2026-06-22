'use client'

import { useMemo, useState } from 'react'
import { Search, Plus, MoreVertical, Pencil, Trash2, ChevronDown, FolderPlus } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

interface ProjectCard {
  id: number
  name: string
  memory?: string | null
  createdAt?: Date | null
  updatedAt?: Date | null
}

interface ProjectsViewProps {
  projects: ProjectCard[]
  onSelectProject: (id: number) => void
  onDeleteProject: (id: number) => void
  onRenameProject: (id: number) => void
  onNewProject: () => void
}

type SortKey = 'recent' | 'name'

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Last updated',
  name: 'Name (A–Z)',
}

function formatDate(date: Date | null | undefined): string | null {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ProjectsView({
  projects,
  onSelectProject,
  onDeleteProject,
  onRenameProject,
  onNewProject,
}: ProjectsViewProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? projects.filter(
          p =>
            p.name.toLowerCase().includes(q) ||
            (p.memory ?? '').toLowerCase().includes(q)
        )
      : projects
    const sorted = [...filtered]
    if (sort === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name))
    } else {
      const ts = (p: ProjectCard) => {
        const d = p.updatedAt ?? p.createdAt
        return d ? new Date(d).getTime() : 0
      }
      sorted.sort((a, b) => ts(b) - ts(a))
    }
    return sorted
  }, [projects, query, sort])

  return (
    <div className="flex-1 overflow-y-auto p-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <h2 className="text-2xl font-semibold text-foreground">Projects</h2>
        <div className="flex items-center gap-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 transition-colors">
                <span className="text-muted-foreground/70">Sort by</span>
                <span className="font-medium text-foreground">{SORT_LABELS[sort]}</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="min-w-[160px] glass-panel rounded-xl p-1.5 shadow-2xl border border-border z-50"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
                  <DropdownMenu.Item
                    key={key}
                    onClick={() => setSort(key)}
                    className="flex items-center px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-accent outline-none transition-colors"
                  >
                    {SORT_LABELS[key]}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button
            onClick={onNewProject}
            className="flex items-center gap-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg px-3.5 py-2 hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New project
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search projects…"
          aria-label="Search projects"
          className="w-full rounded-xl border border-border bg-card pl-10 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-all"
        />
      </div>

      {/* Grid */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <FolderPlus className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">No projects yet.</p>
          <button
            onClick={onNewProject}
            className="mt-4 flex items-center gap-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg px-3.5 py-2 hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New project
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects match “{query}”.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map(p => {
            const updated = formatDate(p.updatedAt ?? p.createdAt)
            return (
              <div
                key={p.id}
                className="group relative glass-panel rounded-xl hover:border-primary/40 transition-colors"
              >
                <button
                  onClick={() => onSelectProject(p.id)}
                  className="flex flex-col gap-2 w-full text-left p-5 min-h-[150px]"
                >
                  <span className="font-semibold text-foreground truncate pr-8">{p.name}</span>
                  {p.memory ? (
                    <p className="text-sm text-muted-foreground line-clamp-3 flex-1">{p.memory}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground/40 italic flex-1">No description</p>
                  )}
                  {updated && (
                    <span className="text-xs text-muted-foreground/70 mt-auto">Updated {updated}</span>
                  )}
                </button>

                {/* Kebab menu (top-right, outside the open-project button) */}
                <div className="absolute top-3 right-3">
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        aria-label={`Project options for ${p.name}`}
                        className="p-1.5 rounded-lg text-muted-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        align="end"
                        sideOffset={6}
                        className="min-w-[160px] glass-panel rounded-xl p-1.5 shadow-2xl border border-border z-50"
                      >
                        <DropdownMenu.Item
                          onClick={() => onRenameProject(p.id)}
                          className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-accent outline-none transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          Rename
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onClick={() => onDeleteProject(p.id)}
                          className="flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg cursor-pointer text-destructive hover:bg-destructive/10 outline-none transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
