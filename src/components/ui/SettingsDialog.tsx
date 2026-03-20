'use client'

import { memo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Palette, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppearanceSettingsTab } from '@/components/settings/AppearanceSettingsTab'
import { ModelDefaultsSettingsTab } from '@/components/settings/ModelDefaultsSettingsTab'
import type { FontSize, MessageDensity } from '@/hooks/useAppearanceSettings'

interface Model {
  name: string
  model: string
  digest: string
}

type SettingsTab = 'appearance' | 'defaults'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  models: Model[]
  onSettingsChanged?: () => void
  fontSize: FontSize
  onFontSizeChange: (size: FontSize) => void
  messageDensity: MessageDensity
  onMessageDensityChange: (density: MessageDensity) => void
}

const tabs: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'defaults', label: 'Model Defaults', icon: SlidersHorizontal },
]

export const SettingsDialog = memo(function SettingsDialog({
  open,
  onOpenChange,
  models,
  onSettingsChanged,
  fontSize,
  onFontSizeChange,
  messageDensity,
  onMessageDensityChange,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 glass-panel rounded-xl shadow-2xl z-50 focus:outline-none w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
            <Dialog.Title className="text-lg font-semibold">
              Settings
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1 rounded hover:bg-white/10 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
            <Dialog.Description className="sr-only">
              Configure appearance and model defaults
            </Dialog.Description>
          </div>

          {/* Body */}
          <div className="flex flex-1 min-h-0">
            {/* Tab Navigation */}
            <nav className="w-48 border-r border-white/10 p-2 shrink-0">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors text-left",
                      activeTab === tab.id
                        ? "bg-primary/15 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {tab.label}
                  </button>
                )
              })}
            </nav>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'appearance' && (
                <AppearanceSettingsTab
                  fontSize={fontSize}
                  onFontSizeChange={onFontSizeChange}
                  messageDensity={messageDensity}
                  onMessageDensityChange={onMessageDensityChange}
                />
              )}
              {activeTab === 'defaults' && (
                <ModelDefaultsSettingsTab
                  models={models}
                  onSettingsChanged={onSettingsChanged}
                />
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
})
