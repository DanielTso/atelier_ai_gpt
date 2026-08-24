"use client"

import * as Select from "@radix-ui/react-select"
import { ChevronDown, Check, Sparkles, Image as ImageIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Model, ModelPricing } from "@/types"

interface ModelSelectProps {
  models: Model[]
  value: string
  onChange: (value: string) => void
}

/** `5` -> "5", `2.5` -> "2.50" — every current rate is a whole number, but this
 *  keeps a future fractional rate readable instead of a long float. */
function formatRate(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/**
 * Render a model's per-MTok price for the picker row. The `{0, 0, estimated:
 * true}` pricing shape is a deliberate sentinel for "not token-priced" (Nano
 * Banana 2 is priced per image, not per token) — it must never print as
 * "$0.00" / "~$0 est.", which would read as free. Every other `estimated`
 * price gets a leading `~` on the numbers plus a separate "est." chip
 * (matching the vision/hybrid chip idiom in DocumentCard.tsx).
 */
function ModelPrice({ pricing }: { pricing: ModelPricing }) {
  if (pricing.inputPerMTok === 0 && pricing.outputPerMTok === 0) {
    return <span className="text-[10px] text-muted-foreground shrink-0">per image</span>
  }
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className="text-[10px] text-muted-foreground">
        {pricing.estimated ? '~' : ''}${formatRate(pricing.inputPerMTok)} / ${formatRate(pricing.outputPerMTok)}
      </span>
      {pricing.estimated && (
        <span className="text-[10px] px-1 py-0.5 bg-primary/15 text-primary rounded">est.</span>
      )}
    </span>
  )
}

export function ModelSelect({ models, value, onChange }: ModelSelectProps) {
  const selectedModel = models.find(m => m.model === value)
  // Group by the registry-provided `provider` field, not a name substring —
  // robust to a new Claude family name (Fable, a future family, etc.).
  const claudeModels = models.filter(m => m.provider === 'anthropic')
  const imageModels = models.filter(m => m.provider === 'google')

  return (
    <div className="flex items-center gap-1.5">
      <Select.Root value={value} onValueChange={onChange}>
        <Select.Trigger
          className={cn(
            "inline-flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-sm",
            "bg-muted border border-border hover:border-border",
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
              "bg-popover border border-border shadow-xl",
              "animate-in fade-in-0 zoom-in-95"
            )}
            position="popper"
            sideOffset={5}
          >
            <Select.Viewport className="p-1 max-h-70 overflow-y-auto">
              {models.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">Loading models...</div>
              )}

              {claudeModels.length > 0 && (
                <Select.Group>
                  <Select.Label className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <Sparkles className="h-3 w-3" />
                    Claude
                  </Select.Label>
                  {claudeModels.map(m => (
                    <ModelItem key={m.model} model={m} />
                  ))}
                </Select.Group>
              )}

              {imageModels.length > 0 && (
                <Select.Group>
                  <Select.Label className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <ImageIcon className="h-3 w-3" />
                    Image
                  </Select.Label>
                  {imageModels.map(m => (
                    <ModelItem key={m.model} model={m} />
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

function ModelItem({ model }: { model: Model }) {
  return (
    <Select.Item
      value={model.model}
      className={cn(
        "relative flex items-center justify-between gap-2 px-3 py-2 pl-8 rounded-lg text-sm cursor-pointer",
        "text-foreground outline-none",
        "hover:bg-accent focus:bg-accent",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "data-[state=checked]:text-primary data-[state=checked]:font-medium",
        "transition-colors"
      )}
    >
      <Select.ItemIndicator className="absolute left-2 flex items-center justify-center">
        <Check className="h-4 w-4 text-primary" />
      </Select.ItemIndicator>
      <Select.ItemText className="truncate">{model.name}</Select.ItemText>
      <ModelPrice pricing={model.pricing} />
    </Select.Item>
  )
}
