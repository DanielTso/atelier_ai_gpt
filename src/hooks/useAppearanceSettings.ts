'use client'

import { useLocalStorage } from './useLocalStorage'

export type FontSize = 'small' | 'medium' | 'large'
export type MessageDensity = 'compact' | 'comfortable' | 'spacious'

const FONT_SIZES: readonly string[] = ['small', 'medium', 'large']
const DENSITIES: readonly string[] = ['compact', 'comfortable', 'spacious']

export function useAppearanceSettings() {
  // Validate against the union so a stale/invalid stored string falls back to the
  // default instead of producing an unmatched className.
  const [fontSize, setFontSize] = useLocalStorage<FontSize>(
    'app-font-size', 'medium', (v) => typeof v === 'string' && FONT_SIZES.includes(v))
  const [messageDensity, setMessageDensity] = useLocalStorage<MessageDensity>(
    'app-message-density', 'comfortable', (v) => typeof v === 'string' && DENSITIES.includes(v))

  return {
    fontSize,
    setFontSize,
    messageDensity,
    setMessageDensity,
  }
}
