"use client"

import * as Select from "@radix-ui/react-select"
import { ChevronDown, Check, Cloud } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Model } from "@/types"

interface ModelSelectProps {
  models: Model[]
  value: string
  onChange: (value: string) => void
}

export function ModelSelect({ models, value, onChange }: ModelSelectProps) {
  const selectedModel = models.find(m => m.model === value)

  return (
    <div className="flex items-center gap-1.5">
      <Select.Root value={value} onValueChange={onChange}>
        <Select.Trigger
          className={cn(
            "inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-sm",
            "bg-white/10 border border-white/10 hover:border-white/20",
            "focus:outline-none focus:ring-2 focus:ring-primary/50",
            "transition-all min-w-40",
            "data-placeholder:text-muted-foreground"
          )}
          aria-label="Select model"
        >
          <Select.Value placeholder="Select model...">
            {selectedModel?.name ?? "Select model..."}
          </Select.Value>
          <Select.Icon>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            className={cn(
              "z-50 min-w-50 overflow-hidden rounded-xl",
              "bg-popover border border-white/10 shadow-xl",
              "animate-in fade-in-0 zoom-in-95"
            )}
            position="popper"
            sideOffset={5}
          >
            <Select.Viewport className="p-1 max-h-70 overflow-y-auto">
              {models.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">Loading models...</div>
              )}

              {models.length > 0 && (
                <Select.Group>
                  <Select.Label className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <Cloud className="h-3 w-3" />
                    Google Gemini
                  </Select.Label>
                  {models.map(m => (
                    <ModelItem key={m.model} value={m.model}>
                      {m.name}
                    </ModelItem>
                  ))}
                </Select.Group>
              )}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  )
}

function ModelItem({
  children,
  value,
}: {
  children: React.ReactNode
  value: string
}) {
  return (
    <Select.Item
      value={value}
      className={cn(
        "relative flex items-center justify-between px-3 py-2 pl-8 rounded-lg text-sm cursor-pointer",
        "text-foreground outline-none",
        "hover:bg-white/10 focus:bg-white/10",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "data-[state=checked]:text-primary data-[state=checked]:font-medium",
        "transition-colors"
      )}
    >
      <Select.ItemIndicator className="absolute left-2 flex items-center justify-center">
        <Check className="h-4 w-4 text-primary" />
      </Select.ItemIndicator>
      <Select.ItemText>{children}</Select.ItemText>
    </Select.Item>
  )
}
