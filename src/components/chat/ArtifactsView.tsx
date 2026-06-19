'use client'

import { useEffect, useState } from 'react'
import { Boxes, Loader2 } from 'lucide-react'
import type { ArtifactSummary } from '@/types'
import { getAllArtifacts } from '@/app/actions'
import { ArtifactCard } from '@/components/chat/ArtifactCard'

export function ArtifactsView() {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null)

  useEffect(() => {
    let active = true
    getAllArtifacts().then(rows => { if (active) setArtifacts(rows) }).catch(() => { if (active) setArtifacts([]) })
    return () => { active = false }
  }, [])

  if (artifacts === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
        <Boxes className="h-10 w-10 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold text-foreground">Artifacts</h2>
        <p className="text-sm text-muted-foreground">No artifacts yet. Generated files will appear here.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h2 className="text-2xl font-semibold text-foreground mb-6">Artifacts</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {artifacts.map(a => <ArtifactCard key={a.id} artifact={a} />)}
      </div>
    </div>
  )
}
