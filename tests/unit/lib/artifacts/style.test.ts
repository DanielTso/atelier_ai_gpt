// tests/unit/lib/artifacts/style.test.ts
import { describe, it, expect } from 'vitest'
import { BRAND, FONT, SIZE, argb, pdfRgb } from '@/lib/artifacts/style'

describe('artifact style', () => {
  it('exposes brand hex without # prefix', () => {
    expect(BRAND.terracotta).toBe('C96442')
    expect(BRAND.white).toBe('FFFFFF')
  })
  it('mirrors the warm palette in globals.css, not the retired navy/steel blue (audit X13)', () => {
    expect(BRAND.ink).toBe('20201E')
    expect(BRAND.mutedLine).toBe('E8E6DF')
    expect(BRAND.clay).toBe('6B4A38')
    const values: string[] = Object.values(BRAND)
    expect(values).not.toContain('1F3447')
    expect(values).not.toContain('4F7396')
  })
  it('argb prefixes FF for exceljs', () => {
    expect(argb(BRAND.terracotta)).toBe('FFC96442')
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
