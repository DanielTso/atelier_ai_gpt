'use client'

import { memo } from 'react'
import { Lightbulb, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface PersonaSuggestionBannerProps {
  personaName: string
  personaIcon: string
  reason: string
  onApply: () => void
  onDismiss: () => void
  visible: boolean
}

export const PersonaSuggestionBanner = memo(function PersonaSuggestionBanner({
  personaName,
  personaIcon,
  reason,
  onApply,
  onDismiss,
  visible,
}: PersonaSuggestionBannerProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 10, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: 10, height: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto mb-2"
        >
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-sm">
            <Lightbulb className="h-4 w-4 text-primary shrink-0" />
            <span className="text-muted-foreground flex-1">
              {reason}.{' '}
              Switch to{' '}
              <span className="text-foreground font-medium">
                {personaIcon} {personaName}
              </span>
              ?
            </span>
            <button
              onClick={onApply}
              className="px-2.5 py-1 rounded-md bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors"
            >
              Apply
            </button>
            <button
              onClick={onDismiss}
              className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
