'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'

/** Clickable next-step suggestions shown under a finished response. */
export function FollowUpChips({ suggestions, onPick }: {
  suggestions: string[]
  onPick: (suggestion: string) => void
}) {
  return (
    <AnimatePresence>
      {suggestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.22 }}
          className="w-full max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto px-4 pb-2 flex flex-wrap gap-2"
        >
          {suggestions.map((s, i) => (
            <motion.button
              key={s}
              type="button"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.05 }}
              onClick={() => onPick(s)}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-accent transition motion-safe:active:scale-[0.97] text-left"
            >
              <Sparkles className="h-3 w-3 text-primary/60 shrink-0" />
              {s}
            </motion.button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
