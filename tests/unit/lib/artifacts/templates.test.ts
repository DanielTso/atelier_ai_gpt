import { describe, it, expect } from 'vitest'
import { blankArtifactTemplate } from '@/lib/artifacts/templates'
import { renderArtifact } from '@/lib/artifacts/render'
import type { ArtifactType, SheetSpec } from '@/lib/artifacts/types'

const TYPES: ArtifactType[] = ['html', 'pdf', 'docx', 'pptx', 'xlsx']

describe('blankArtifactTemplate', () => {
  it('returns a non-empty title/content for every type', () => {
    for (const t of TYPES) {
      const tpl = blankArtifactTemplate(t)
      expect(tpl.title.length).toBeGreaterThan(0)
      expect(tpl.content.length).toBeGreaterThan(0)
    }
  })

  it('xlsx content parses to a SheetSpec[] with a header row', () => {
    const tpl = blankArtifactTemplate('xlsx')
    expect(tpl.format).toBe('sheets')
    const sheets = JSON.parse(tpl.content) as SheetSpec[]
    expect(Array.isArray(sheets)).toBe(true)
    expect(sheets[0]?.rows.length).toBeGreaterThan(0)
  })

  it('each template renders to a non-empty buffer', async () => {
    for (const t of TYPES) {
      const tpl = blankArtifactTemplate(t)
      const renderContent = tpl.format === 'sheets' ? (JSON.parse(tpl.content) as SheetSpec[]) : tpl.content
      const out = await renderArtifact(t, tpl.title, renderContent)
      expect(out.ext).toBe(t)
      expect(out.buffer.length).toBeGreaterThan(0)
    }
  })
})
