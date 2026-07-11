'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Globe, ImageIcon, FileText, type LucideIcon } from 'lucide-react'
import type { AssistantStage } from '@/lib/chatStage'

// One-line staged status shown in place of the reply before any bubble content
// exists. 'submitted' is the quick-reply state (warm shimmer bars, no words);
// the named stages appear only when real stream events warrant them.
const STAGE_META: Partial<Record<AssistantStage, { icon: LucideIcon; label: string }>> = {
  thinking: { icon: Sparkles, label: 'Thinking…' },
  searching: { icon: Globe, label: 'Searching the web…' },
  'generating-image': { icon: ImageIcon, label: 'Creating image…' },
  'building-artifact': { icon: FileText, label: 'Building document…' },
}

export function ThinkingStatus({ stage }: { stage: AssistantStage }) {
  if (stage === 'idle' || stage === 'writing') return null
  const meta = STAGE_META[stage]

  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-xs font-semibold text-primary">
        AI
      </div>
      <div className="bg-muted p-4 rounded-2xl rounded-tl-none border border-border min-w-0">
        {!meta ? (
          <div className="w-56 max-w-full space-y-2">
            <div className="skeleton-shimmer h-3.5 w-48" />
            <div className="skeleton-shimmer h-3.5 w-32" />
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-2.5"
            >
              <meta.icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-sm text-shimmer">{meta.label}</span>
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}
