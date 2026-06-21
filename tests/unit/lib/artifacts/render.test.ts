import { describe, it, expect, vi } from 'vitest'
import { renderArtifact } from '@/lib/artifacts/render'

// exceljs/docx/pdf rendering can exceed the 5s default under parallel-worker load
// (it's CPU-heavy); give these a generous timeout so the suite isn't flaky.
vi.setConfig({ testTimeout: 30000 })

const PK = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // ZIP (xlsx/docx)

describe('renderArtifact', () => {
  it('renders xlsx from sheet specs (ZIP magic)', async () => {
    const out = await renderArtifact('xlsx', 'Schedule', [{ name: 'Tasks', rows: [['Task', 'Days'], ['Excavation', 5]] }])
    expect(out.ext).toBe('xlsx')
    expect(out.contentType).toContain('spreadsheetml')
    expect(out.buffer.subarray(0, 4)).toEqual(PK)
    expect(out.buffer.length).toBeGreaterThan(100)
  })

  it('renders docx from markdown (ZIP magic)', async () => {
    const out = await renderArtifact('docx', 'Report', '# Title\n\nA paragraph.\n\n- one\n- two')
    expect(out.ext).toBe('docx')
    expect(out.contentType).toContain('wordprocessingml')
    expect(out.buffer.subarray(0, 4)).toEqual(PK)
  })

  it('renders pdf from markdown (%PDF magic)', async () => {
    const out = await renderArtifact('pdf', 'Report', '# Title\n\nA paragraph of body text.')
    expect(out.ext).toBe('pdf')
    expect(out.contentType).toBe('application/pdf')
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('throws on an unknown type', async () => {
    // @ts-expect-error invalid type
    await expect(renderArtifact('pptx', 't', 'x')).rejects.toThrow()
  })
})
