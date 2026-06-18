'use client'

import { Boxes } from 'lucide-react'

export function ArtifactsView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
      <Boxes className="h-10 w-10 text-muted-foreground/40" />
      <h2 className="text-xl font-semibold text-foreground">Artifacts</h2>
      <p className="text-sm text-muted-foreground">No artifacts yet. Generated files will appear here.</p>
    </div>
  )
}
