'use client'

import { memo, useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getProjectDefaults, updateProjectDefaults, getProjectPersonaStats } from '@/app/actions'
import { usePersonas, type Persona } from '@/hooks/usePersonas'
import { toast } from 'sonner'
import type { Model } from '@/types'

interface ProjectDefaultsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  projectName: string
  models: Model[]
}

export const ProjectDefaultsDialog = memo(function ProjectDefaultsDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  models,
}: ProjectDefaultsDialogProps) {
  const { personas } = usePersonas()
  const [defaultPersonaId, setDefaultPersonaId] = useState<string | null>(null)
  const [defaultModel, setDefaultModel] = useState<string | null>(null)
  const [stats, setStats] = useState<{ personaId: string; messageCount: number | null; modelUsed: string | null }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([
      getProjectDefaults(projectId),
      getProjectPersonaStats(projectId),
    ]).then(([defaults, usageStats]) => {
      setDefaultPersonaId(defaults.defaultPersonaId ?? null)
      setDefaultModel(defaults.defaultModel ?? null)
      setStats(usageStats)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [open, projectId])

  const handleSave = async () => {
    try {
      await updateProjectDefaults(projectId, {
        defaultPersonaId,
        defaultModel,
      })
      toast.success('Project defaults saved')
      onOpenChange(false)
    } catch {
      toast.error('Failed to save defaults')
    }
  }

  const totalMessages = stats.reduce((sum, s) => sum + (s.messageCount ?? 0), 0)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md glass-panel rounded-2xl p-6 z-50 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <Dialog.Title className="text-lg font-semibold">
              Project Defaults: {projectName}
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-white/10 transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
          ) : (
            <div className="space-y-5">
              {/* Default Persona */}
              <div>
                <label className="block text-sm font-medium mb-1.5">Default Persona</label>
                <select
                  value={defaultPersonaId || ''}
                  onChange={(e) => setDefaultPersonaId(e.target.value || null)}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">None (use global default)</option>
                  {personas.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.icon} {p.name}{p.modelConstraint ? ` (${p.modelConstraint})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Auto-applied to new chats in this project
                </p>
              </div>

              {/* Default Model */}
              <div>
                <label className="block text-sm font-medium mb-1.5">Default Model</label>
                <select
                  value={defaultModel || ''}
                  onChange={(e) => setDefaultModel(e.target.value || null)}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">None (use global default)</option>
                  {models.map(m => (
                    <option key={m.model} value={m.model}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Usage Stats */}
              {stats.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">Usage Stats</span>
                  </div>
                  <div className="space-y-1.5">
                    {stats.slice(0, 5).map((s, i) => {
                      const persona = personas.find(p => p.id === s.personaId)
                      const percent = totalMessages > 0
                        ? Math.round(((s.messageCount ?? 0) / totalMessages) * 100)
                        : 0
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="w-5 text-center">{persona?.icon || '?'}</span>
                          <span className="flex-1 truncate text-muted-foreground">
                            {persona?.name || s.personaId}
                          </span>
                          <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary/50 rounded-full"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-muted-foreground">
                            {percent}%
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Save button */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => onOpenChange(false)}
                  className="px-4 py-2 text-sm rounded-lg hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 text-sm rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
                >
                  Save Defaults
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
})
