'use client'

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { motion } from 'framer-motion'
import { Boxes, Loader2, Search, ChevronDown, Plus } from 'lucide-react'
import type { ArtifactSummary } from '@/types'
import { ARTIFACT_TYPE_LABELS } from '@/types'
import type { ArtifactType } from '@/lib/artifacts/types'
import { getAllArtifacts, createBlankArtifact } from '@/app/actions'
import { filterArtifacts, type ArtifactTypeFilter } from '@/lib/artifactFilter'
import { ArtifactGalleryCard } from '@/components/chat/ArtifactGalleryCard'
import { GalleryGridSkeleton } from '@/components/chat/LoadingSkeletons'
import { ArtifactWorkspace } from '@/components/chat/ArtifactWorkspace'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useAutoCollapseSidebar } from '@/hooks/useAutoCollapseSidebar'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const FILTERS: { value: ArtifactTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'html', label: 'HTML' }, { value: 'pdf', label: 'PDF' },
  { value: 'xlsx', label: 'Spreadsheet' }, { value: 'docx', label: 'Document' }, { value: 'pptx', label: 'Slides' },
]
const NEW_TYPES: ArtifactType[] = ['html', 'docx', 'pdf', 'pptx', 'xlsx']

export function ArtifactsView({ onOpenChat, sidebarCollapsedRef, setSidebarCollapsed }: {
  onOpenChat?: (chatId: number) => void
  sidebarCollapsedRef?: RefObject<boolean>
  setSidebarCollapsed?: (v: boolean) => void
}) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<ArtifactTypeFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [openInEdit, setOpenInEdit] = useState(false)
  const [panelWidth, setPanelWidth] = useLocalStorage('artifact-panel-width', 448)

  const reload = () => getAllArtifacts().then(setArtifacts).catch(() => setArtifacts([]))
  useEffect(() => { reload() }, [])

  // Auto-collapse the sidebar when the gallery's artifact panel is dragged wide, mirroring
  // the chat workspace. Falls back to no-ops if the sidebar control wasn't provided.
  const fallbackCollapsedRef = useRef(false)
  useAutoCollapseSidebar({
    active: activeId != null,
    panelWidth,
    sidebarCollapsedRef: sidebarCollapsedRef ?? fallbackCollapsedRef,
    setSidebarCollapsed: setSidebarCollapsed ?? (() => {}),
  })

  const visible = useMemo(() => filterArtifacts(artifacts ?? [], { query, type: typeFilter }), [artifacts, query, typeFilter])
  const active = artifacts?.find(a => a.id === activeId) ?? null

  async function handleNew(type: ArtifactType) {
    setNewOpen(false); setCreating(true)
    try {
      const { artifactId } = await createBlankArtifact(type)
      await reload()
      setOpenInEdit(true); setActiveId(artifactId)
    } catch {
      toast.error('Could not create artifact. Is file storage configured?')
    } finally { setCreating(false) }
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-serif font-medium text-foreground">Artifacts</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setFilterOpen(o => !o)} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-accent">
                Filter by {FILTERS.find(f => f.value === typeFilter)!.label} <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {filterOpen && (
                <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-border bg-card py-1 shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150" onMouseLeave={() => setFilterOpen(false)}>
                  {FILTERS.map(f => (
                    <button key={f.value} onClick={() => { setTypeFilter(f.value); setFilterOpen(false) }}
                      className={cn('block w-full px-3 py-1.5 text-left text-sm hover:bg-accent', typeFilter === f.value ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button disabled={creating} onClick={() => setNewOpen(o => !o)} className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-60">
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} New artifact <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {newOpen && (
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-border bg-card py-1 shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150" onMouseLeave={() => setNewOpen(false)}>
                  {NEW_TYPES.map(t => (
                    <button key={t} onClick={() => handleNew(t)} className="block w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent">
                      {ARTIFACT_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="relative mb-6">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search artifacts..."
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring" />
        </div>

        {artifacts === null ? (
          <GalleryGridSkeleton />
        ) : visible.length === 0 ? (
          <motion.div
            className="flex flex-col items-center justify-center gap-3 py-20 text-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-primary/15 to-primary/5 ring-1 ring-primary/15 flex items-center justify-center">
              <Boxes className="h-6 w-6 text-primary/70" />
            </div>
            <p className="text-sm text-muted-foreground">
              {artifacts.length === 0 ? 'No artifacts yet. Generated files will appear here.' : 'No artifacts match your search.'}
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map(a => (
              <ArtifactGalleryCard key={a.id} artifact={a}
                onOpen={(id) => { setOpenInEdit(false); setActiveId(id) }}
                onOpenChat={onOpenChat} />
            ))}
          </div>
        )}
      </div>

      {active && (
        <ArtifactWorkspace
          artifact={active}
          width={panelWidth}
          onWidthChange={setPanelWidth}
          initialMode={openInEdit ? 'edit' : 'preview'}
          onClose={() => setActiveId(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}
