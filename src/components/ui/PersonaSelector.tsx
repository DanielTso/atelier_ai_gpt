'use client'

import { memo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Check, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePersonas, modelShortLabel, effortLabel, type Persona, type Effort } from '@/hooks/usePersonas'

interface PersonaSelectorProps {
  currentPrompt: string | null
  onSelect: (prompt: string | null) => void
  onCustomize?: () => void
  onModelChange?: (model: string) => void
  onEffortChange?: (effort?: Effort) => void
  disabled?: boolean
  side?: 'top' | 'bottom'
}

export const PersonaSelector = memo(function PersonaSelector({
  currentPrompt,
  onSelect,
  onCustomize,
  onModelChange,
  onEffortChange,
  disabled = false,
  side = 'bottom',
}: PersonaSelectorProps) {
  const [open, setOpen] = useState(false)
  const { personas, getPersonaByPrompt } = usePersonas()

  const currentPersona = getPersonaByPrompt(currentPrompt)
  const isCustom = currentPersona.id === 'custom'

  const handleSelect = (persona: Persona) => {
    onSelect(persona.prompt || null)
    // Selecting a persona sets its model and effort together.
    if (persona.model && onModelChange) onModelChange(persona.model)
    if (onEffortChange) onEffortChange(persona.effort)
    setOpen(false)
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors",
            "hover:bg-accent",
            disabled && "opacity-50 cursor-not-allowed",
            !currentPersona.isDefault && !isCustom
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
          title="Select persona"
        >
          <span className="text-sm">{currentPersona.icon}</span>
          <span className="hidden sm:inline max-w-25 truncate">{currentPersona.name}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-65 max-h-105 overflow-y-auto glass-panel rounded-lg p-1.5 shadow-xl z-50"
          sideOffset={5}
          side={side}
          align="start"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground font-medium">
            Personas
          </DropdownMenu.Label>

          {personas.map((persona) => (
            <DropdownMenu.Item
              key={persona.id}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none transition-colors",
                "hover:bg-accent",
                currentPersona.id === persona.id && "bg-primary/10 text-primary"
              )}
              onSelect={() => handleSelect(persona)}
            >
              <span className="text-base w-5 text-center shrink-0">{persona.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate">{persona.name}</span>
                  <span className="shrink-0 text-[10px] px-1 py-0.5 bg-primary/15 text-primary rounded">
                    {modelShortLabel(persona.model)}{persona.effort ? ` · ${effortLabel(persona.effort)}` : ''}
                  </span>
                </div>
                {persona.description && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{persona.description}</p>
                )}
              </div>
              {currentPersona.id === persona.id && <Check className="h-3.5 w-3.5 shrink-0" />}
            </DropdownMenu.Item>
          ))}

          {onCustomize && (
            <>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
              <DropdownMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-accent text-muted-foreground"
                onSelect={() => { onCustomize(); setOpen(false) }}
              >
                <Settings2 className="h-4 w-4" />
                <span>Customize...</span>
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
})
