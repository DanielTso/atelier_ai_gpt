'use client'

import { memo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Check, Gauge } from 'lucide-react'
import { cn } from '@/lib/utils'
import { effortLabel, type Effort } from '@/hooks/usePersonas'

const LEVELS: Effort[] = ['low', 'medium', 'high', 'max']

interface EffortPillProps {
  value?: Effort
  onChange: (effort: Effort) => void
  side?: 'top' | 'bottom'
}

/** Reasoning-effort selector for Claude models. Defaults to the active persona's
 *  effort; overriding it here sets the effort without changing the persona. */
export const EffortPill = memo(function EffortPill({ value, onChange, side = 'top' }: EffortPillProps) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Reasoning effort"
        >
          <Gauge className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{effortLabel(value) ?? 'Effort'}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-40 glass-panel rounded-lg p-1.5 shadow-xl z-50"
          sideOffset={5}
          side={side}
          align="start"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground font-medium">
            Reasoning effort
          </DropdownMenu.Label>
          {LEVELS.map((level) => (
            <DropdownMenu.Item
              key={level}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none transition-colors hover:bg-accent',
                value === level && 'bg-primary/10 text-primary'
              )}
              onSelect={() => { onChange(level); setOpen(false) }}
            >
              <span className="flex-1">{effortLabel(level)}</span>
              {value === level && <Check className="h-3.5 w-3.5" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
})
