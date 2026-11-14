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

  it('renders pptx from markdown (ZIP magic)', async () => {
    const out = await renderArtifact('pptx', 'Deck', '# Slide One\n\n- point a\n- point b\n\n# Slide Two\n\nBody.')
    expect(out.ext).toBe('pptx')
    expect(out.contentType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    expect(out.buffer.subarray(0, 4).equals(PK)).toBe(true)
  })

  it('renders html as a pass-through UTF-8 document', async () => {
    const html = '<!doctype html><html><head><style>body{color:red}</style></head><body><h1>Hi</h1></body></html>'
    const out = await renderArtifact('html', 'Landing', html)
    expect(out.ext).toBe('html')
    expect(out.contentType).toContain('text/html')
    expect(out.buffer.toString('utf-8')).toBe(html)
  })

  it('throws on a content shape that does not match the type instead of rendering an empty file (audit B14)', async () => {
    await expect(renderArtifact('xlsx', 't', '| a | b |')).rejects.toThrow(/array/i)
    await expect(renderArtifact('docx', 't', [{ name: 'T', rows: [['a']] }])).rejects.toThrow(/string/i)
    await expect(renderArtifact('html', 't', [{ name: 'T', rows: [['a']] }])).rejects.toThrow(/string/i)
  })

  it('renders sheets with empty (null) cells and a missing name, as toXlsx allows', async () => {
    // @ts-expect-error null cells and a missing name arrive from parsed JSON (edit/regenerate)
    const out = await renderArtifact('xlsx', 't', [{ rows: [['Item', 'Qty'], ['Rebar', null], ['Flag', true]] }])
    expect(out.buffer.subarray(0, 4)).toEqual(PK)
  })

  it('throws on sheets that are not {name, rows} objects', async () => {
    // @ts-expect-error deliberately malformed (the regenerate route parses model JSON)
    await expect(renderArtifact('xlsx', 't', [{ name: 'T', rows: 'nope' }])).rejects.toThrow(/sheet/i)
  })

  it('throws on an unknown type', async () => {
    // @ts-expect-error invalid type
    await expect(renderArtifact('txt', 't', 'x')).rejects.toThrow()
  })
})
