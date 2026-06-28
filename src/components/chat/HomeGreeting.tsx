'use client'

import { motion, easeOut } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { greetingForHour } from '@/lib/greeting'

export function HomeGreeting({ displayName }: { displayName?: string }) {
  const greeting = greetingForHour(new Date().getHours())
  const text = displayName ? `${greeting}, ${displayName}` : greeting
  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-3 mb-8"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: easeOut }}
    >
      <motion.div
        className="flex items-center justify-center w-14 h-14 rounded-2xl bg-linear-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20"
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Sparkles className="h-8 w-8 text-primary" aria-hidden />
      </motion.div>
      <h1 className="text-4xl font-serif font-medium tracking-tight bg-linear-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent">
        {text}
      </h1>
    </motion.div>
  )
}
