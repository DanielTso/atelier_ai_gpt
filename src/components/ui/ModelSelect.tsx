"use client"

import { useMemo } from "react"
import * as Select from "@radix-ui/react-select"
import { ChevronDown, Check, Cloud, Brain } from "lucide-react"
import { cn } from "@/lib/utils"

interface Model {
  name: string
  model: string
  digest: string
}

interface ModelSelectProps {
  models: Model[]
  value: string
  onChange: (value: string) => void
}

const THINK_ORDER = ['minimal', 'low', 'medium', 'high'] as const
type ThinkLevel = (typeof THINK_ORDER)[number]

const THINK_LABELS: Record<ThinkLevel, string> = {
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
}

/** Split any model ID into its base model + optional thinking level. */
function parseModelId(modelId: string): { base: string; thinkLevel: ThinkLevel | null } {
  if (modelId.endsWith('-deep-think')) {
    return { base: modelId.replace(/-deep-think$/, ''), thinkLevel: 'high' }
  }
  const m = modelId.match(/^(.+)-think-(minimal|low|medium|high)$/)
  if (m) return { base: m[1], thinkLevel: m[2] as ThinkLevel }
  return { base: modelId, thinkLevel: null }
}

/** Reconstruct a model ID from base + level. Pro uses the deep-think suffix for High. */
function buildModelId(base: string, level: ThinkLevel | null): string {
  if (!level) return base
  if (base === 'gemini-3.1-pro-preview' && level === 'high') return `${base}-deep-think`
  return `${base}-think-${level}`
}

export function ModelSelect({ models, value, onChange }: ModelSelectProps) {
  const { base: selectedBase, thinkLevel: selectedThink } = parseModelId(value)

  // Strip thinking variants — dropdown only shows the base models
  const baseModels = useMemo(
    () => models.filter(m =>
      !m.model.match(/-think-(minimal|low|medium|high)$/) &&
      !m.model.includes('-deep-think')
    ),
    [models]
  )

  // Build a map of base model ID → sorted available thinking levels
  const thinkingMap = useMemo(() => {
    const map = new Map<string, ThinkLevel[]>()
    for (const m of models) {
      let base: string, level: ThinkLevel
      if (m.model.endsWith('-deep-think')) {
        base = m.model.replace(/-deep-think$/, '')
        level = 'high'
      } else {
        const match = m.model.match(/^(.+)-think-(minimal|low|medium|high)$/)
        if (!match) continue
        base = match[1]
        level = match[2] as ThinkLevel
      }
      if (!map.has(base)) map.set(base, [])
      map.get(base)!.push(level)
    }
    map.forEach((levels, key) =>
      map.set(key, [...levels].sort((a, b) => THINK_ORDER.indexOf(a) - THINK_ORDER.indexOf(b)))
    )
    return map
  }, [models])

  const availableLevels = thinkingMap.get(selectedBase) ?? []
  const selectedModel = baseModels.find(m => m.model === selectedBase)

  const geminiModels = baseModels.filter(m => m.model.startsWith('gemini'))
  const qwenModels = baseModels.filter(m => m.model.startsWith('qwen'))

  return (
    <div className="flex items-center gap-1.5">
      {/* ── Base model dropdown ── */}
      <Select.Root value={selectedBase} onValueChange={(newBase) => onChange(newBase)}>
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
              {baseModels.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">Loading models...</div>
              )}

              {geminiModels.length > 0 && (
                <Select.Group>
                  <Select.Label className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <Cloud className="h-3 w-3" />
                    Google Gemini
                  </Select.Label>
                  {geminiModels.map(m => (
                    <ModelItem key={m.model} value={m.model} hasThinking={thinkingMap.has(m.model)}>
                      {m.name}
                    </ModelItem>
                  ))}
                </Select.Group>
              )}

              {qwenModels.length > 0 && (
                <Select.Group>
                  {geminiModels.length > 0 && (
                    <Select.Separator className="h-px bg-white/10 my-1" />
                  )}
                  <Select.Label className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <Cloud className="h-3 w-3" />
                    Alibaba Qwen
                  </Select.Label>
                  {qwenModels.map(m => (
                    <ModelItem key={m.model} value={m.model} hasThinking={false}>
                      {m.name}
                    </ModelItem>
                  ))}
                </Select.Group>
              )}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>

      {/* ── Thinking level strip — only rendered when model supports thinking ── */}
      {availableLevels.length > 0 && (
        <div
          className="flex items-center gap-0.5 bg-white/5 border border-white/10 rounded-lg p-0.5"
          title="Thinking level"
        >
          <ThinkPill
            label="Off"
            active={selectedThink === null}
            onClick={() => onChange(selectedBase)}
          />
          {availableLevels.map(level => (
            <ThinkPill
              key={level}
              label={THINK_LABELS[level]}
              active={selectedThink === level}
              onClick={() => onChange(buildModelId(selectedBase, level))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ModelItem({
  children,
  value,
  hasThinking,
}: {
  children: React.ReactNode
  value: string
  hasThinking: boolean
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
      {hasThinking && (
        <Brain className="h-3 w-3 text-muted-foreground/50 ml-2 shrink-0" />
      )}
    </Select.Item>
  )
}

function ThinkPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-0.5 text-xs rounded-md transition-colors",
        active
          ? label === "Off"
            ? "bg-white/15 text-foreground font-medium"
            : "bg-primary/25 text-primary font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-white/10"
      )}
    >
      {label}
    </button>
  )
}
