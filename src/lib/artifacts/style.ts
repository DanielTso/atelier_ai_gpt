// src/lib/artifacts/style.ts
// Brand palette mirrored from globals.css @theme. Stored as #-less uppercase hex
// because docx and pptxgenjs both want bare hex; exceljs wants ARGB; pdf-lib wants 0..1.
export const BRAND = {
  navy: '1F3447',
  steelBlue: '4F7396',
  ink: '16202A',
  slateText: '6F7781',
  softMist: 'F3F1EC',
  mutedLine: 'E3DDD2',
  white: 'FFFFFF',
  success: '3F7252',
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
