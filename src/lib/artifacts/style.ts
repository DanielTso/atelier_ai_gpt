// src/lib/artifacts/style.ts
// Brand palette mirrored from the warm-minimal tokens in globals.css (re-theme
// of 2026-06-25). globals.css keeps the old token NAMES with warm values; here
// they are named for what they are: terracotta = --brand-steel-blue (the
// accent), clay = --brand-navy (deep warm clay). Stored as #-less uppercase hex
// because docx and pptxgenjs both want bare hex; exceljs wants ARGB; pdf-lib wants 0..1.
export const BRAND = {
  terracotta: 'C96442',
  clay: '6B4A38',
  ink: '20201E',
  slateText: '78776E',
  softMist: 'F2EFE9',
  mutedLine: 'E8E6DF',
  white: 'FFFFFF',
  success: '4F7A4A',
  warning: 'A06D2E',
} as const

export const FONT = { office: 'Calibri', mono: 'Consolas' } as const

// Point sizes for headings + body.
export const SIZE = { h1: 16, h2: 13, h3: 11.5, body: 11 } as const

/** exceljs fills/fonts use 8-digit ARGB. */
export const argb = (hex: string): string => `FF${hex}`

/** pdf-lib rgb() wants 0..1 channel floats. */
export const pdfRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(0, 2), 16) / 255,
  parseInt(hex.slice(2, 4), 16) / 255,
  parseInt(hex.slice(4, 6), 16) / 255,
]
