'use client'

import { memo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Check, Settings2, Cloud, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePersonas, type Persona } from '@/hooks/usePersonas'

interface PersonaSelectorProps {
  currentPrompt: string | null
  onSelect: (prompt: string | null) => void
  onCustomize?: () => void
  onModelChange?: (model: string) => void
  disabled?: boolean
  side?: 'top' | 'bottom'
}

export const PersonaSelector = memo(function PersonaSelector({
  currentPrompt,
  onSelect,
  onCustomize,
  onModelChange,
  disabled = false,
  side = 'bottom',
}: PersonaSelectorProps) {
  const [open, setOpen] = useState(false)
  const { personas, getPersonaByPrompt } = usePersonas()

  const currentPersona = getPersonaByPrompt(currentPrompt)
  const isCustomPrompt = currentPrompt && !currentPersona

  // Split personas into regular and combo (those with modelConstraint)
  const regularPersonas = personas.filter(p => !p.modelConstraint)
  const comboPresets = personas.filter(p => p.modelConstraint)

  const handleSelect = (persona: Persona) => {
    onSelect(persona.prompt || null)
    // If combo preset has a preferred model, auto-switch
    if (persona.preferredModel && onModelChange) {
      onModelChange(persona.preferredModel)
    }
    setOpen(false)
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors",
            "hover:bg-white/10",
            disabled && "opacity-50 cursor-not-allowed",
            currentPersona && currentPersona.id !== 'default'
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
          title="Select persona"
        >
          <span className="text-sm">
            {isCustomPrompt ? '✏️' : currentPersona?.icon || '🤖'}
          </span>
          <span className="hidden sm:inline max-w-[80px] truncate">
            {isCustomPrompt ? 'Custom' : currentPersona?.name || 'Default'}
          </span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[220px] max-h-[400px] overflow-y-auto glass-panel rounded-lg p-1.5 shadow-xl z-50"
          sideOffset={5}
          side={side}
          align="start"
        >
          {/* Regular Personas Section */}
          <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground font-medium">
            Personas
          </DropdownMenu.Label>

          {regularPersonas.map((persona) => (
            <DropdownMenu.Item
              key={persona.id}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none transition-colors",
                "hover:bg-white/10",
                currentPersona?.id === persona.id && "bg-primary/10 text-primary"
              )}
              onSelect={() => handleSelect(persona)}
            >
              <span className="text-base w-5 text-center">{persona.icon}</span>
              <span className="flex-1">{persona.name}</span>
              {currentPersona?.id === persona.id && (
                <Check className="h-3.5 w-3.5" />
              )}
              {!persona.isDefault && (
                <span className="text-[10px] px-1 py-0.5 bg-white/10 rounded">
                  custom
                </span>
              )}
            </DropdownMenu.Item>
          ))}

          {/* Combo Presets Section */}
          {comboPresets.length > 0 && (
            <>
              <DropdownMenu.Separator className="h-px bg-white/10 my-1" />
              <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground font-medium">
                Model + Persona
              </DropdownMenu.Label>

              {comboPresets.map((persona) => (
                <DropdownMenu.Item
                  key={persona.id}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none transition-colors",
                    "hover:bg-white/10",
                    currentPersona?.id === persona.id && "bg-primary/10 text-primary"
                  )}
                  onSelect={() => handleSelect(persona)}
                >
                  <span className="text-base w-5 text-center">{persona.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{persona.name}</span>
                      {persona.modelConstraint === 'cloud' && (
                        <span className="shrink-0 flex items-center gap-0.5 text-[10px] px-1 py-0.5 bg-blue-500/15 text-blue-300 rounded">
                          <Cloud className="h-2.5 w-2.5" />
                          Cloud
                        </span>
                      )}
                    </div>
                    {persona.description && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{persona.description}</p>
                    )}
                  </div>
                  {currentPersona?.id === persona.id && (
                    <Check className="h-3.5 w-3.5 shrink-0" />
                  )}
                </DropdownMenu.Item>
              ))}
            </>
          )}

          {onCustomize && (
            <>
              <DropdownMenu.Separator className="h-px bg-white/10 my-1" />
              <DropdownMenu.Item
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer outline-none hover:bg-white/10 text-muted-foreground"
                onSelect={() => {
                  onCustomize()
                  setOpen(false)
                }}
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
