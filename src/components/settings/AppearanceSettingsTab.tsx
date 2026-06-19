'use client'

import { memo } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FontSize, MessageDensity } from '@/hooks/useAppearanceSettings'

interface AppearanceSettingsTabProps {
  fontSize: FontSize
  onFontSizeChange: (size: FontSize) => void
  messageDensity: MessageDensity
  onMessageDensityChange: (density: MessageDensity) => void
  displayName: string
  onDisplayNameChange: (value: string) => void
}

export const AppearanceSettingsTab = memo(function AppearanceSettingsTab({
  fontSize,
  onFontSizeChange,
  messageDensity,
  onMessageDensityChange,
  displayName,
  onDisplayNameChange,
}: AppearanceSettingsTabProps) {
  const { theme, setTheme } = useTheme()

  const themes = [
    { id: 'light' as const, label: 'Light', icon: Sun },
    { id: 'dark' as const, label: 'Dark', icon: Moon },
    { id: 'system' as const, label: 'System', icon: Monitor },
  ]

  const fontSizes: { id: FontSize; label: string }[] = [
    { id: 'small', label: 'Small' },
    { id: 'medium', label: 'Medium' },
    { id: 'large', label: 'Large' },
  ]

  const densities: { id: MessageDensity; label: string }[] = [
    { id: 'compact', label: 'Compact' },
    { id: 'comfortable', label: 'Comfortable' },
    { id: 'spacious', label: 'Spacious' },
  ]

  return (
    <div className="space-y-6">
      {/* Display name */}
      <div className="space-y-2">
        <label htmlFor="display-name" className="text-sm font-medium">Display name</label>
        <input
          id="display-name" aria-label="Display name" type="text" value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          placeholder="Your name (shown in the greeting)"
          className="w-full rounded-lg border border-border bg-background p-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Theme */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Theme</label>
        <div className="grid grid-cols-3 gap-2">
          {themes.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  "flex flex-col items-center gap-2 p-3 rounded-lg border transition-all",
                  theme === t.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-white/10 hover:border-white/20 hover:bg-white/5 text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs font-medium">{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Font Size */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Font Size</label>
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          {fontSizes.map((s) => (
            <button
              key={s.id}
              onClick={() => onFontSizeChange(s.id)}
              className={cn(
                "flex-1 px-3 py-2 text-sm transition-colors",
                fontSize === s.id
                  ? "bg-primary/20 text-primary font-medium"
                  : "hover:bg-white/5 text-muted-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Message Density */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Message Density</label>
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          {densities.map((d) => (
            <button
              key={d.id}
              onClick={() => onMessageDensityChange(d.id)}
              className={cn(
                "flex-1 px-3 py-2 text-sm transition-colors",
                messageDensity === d.id
                  ? "bg-primary/20 text-primary font-medium"
                  : "hover:bg-white/5 text-muted-foreground"
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
})
