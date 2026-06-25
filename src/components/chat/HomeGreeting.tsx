'use client'

import { Sparkles } from 'lucide-react'
import { greetingForHour } from '@/lib/greeting'

export function HomeGreeting({ displayName }: { displayName?: string }) {
  const greeting = greetingForHour(new Date().getHours())
  const text = displayName ? `${greeting}, ${displayName}` : greeting
  return (
    <div className="flex items-center justify-center gap-3 mb-8">
      <Sparkles className="h-7 w-7 text-primary shrink-0" aria-hidden />
      <h1 className="text-3xl font-serif font-medium text-foreground tracking-tight">{text}</h1>
    </div>
  )
}
