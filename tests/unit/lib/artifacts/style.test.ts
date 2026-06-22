// tests/unit/lib/artifacts/style.test.ts
import { describe, it, expect } from 'vitest'
import { BRAND, FONT, SIZE, argb, pdfRgb } from '@/lib/artifacts/style'

describe('artifact style', () => {
  it('exposes brand hex without # prefix', () => {
    expect(BRAND.navy).toBe('1F3447')
    expect(BRAND.white).toBe('FFFFFF')
  })
  it('argb prefixes FF for exceljs', () => {
    expect(argb(BRAND.navy)).toBe('FF1F3447')
  })
  it('pdfRgb returns a normalized 0..1 triplet', () => {
    const [r, g, b] = pdfRgb('FFFFFF')
    expect([r, g, b]).toEqual([1, 1, 1])
    const [r2] = pdfRgb('000000')
    expect(r2).toBe(0)
  })
  it('exposes font + size scales', () => {
    expect(FONT.office).toBe('Calibri')
    expect(SIZE.h1).toBeGreaterThan(SIZE.body)
  })
})
