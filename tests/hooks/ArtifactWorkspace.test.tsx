// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { ArtifactSummary } from '@/types'
import { ArtifactPreview } from '@/components/chat/ArtifactPreview'

// The workspace imports server actions; mock them so jsdom doesn't pull in `db`.
const { mockGetVersions, mockRestore } = vi.hoisted(() => ({
  mockGetVersions: vi.fn(async () => [] as unknown[]),
  mockRestore: vi.fn(async () => ({ version: 1 })),
}))
vi.mock('@/app/actions', () => ({
  getArtifactVersions: (...a: unknown[]) => mockGetVersions(...(a as [])),
  restoreArtifactVersion: (...a: unknown[]) => mockRestore(...(a as [])),
}))

import { ArtifactWorkspace } from '@/components/chat/ArtifactWorkspace'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function artifact(over: Partial<ArtifactSummary> = {}): ArtifactSummary {
  return {
    id: 1, chatId: 1, type: 'docx', title: 'Spec', status: 'ready',
    downloadUrl: 'signed:doc.docx', createdAt: null, format: 'markdown', content: '# Hello', version: 1,
    ...over,
  }
}

describe('ArtifactPreview', () => {
  it('renders markdown source as HTML (approximate)', () => {
    render(<ArtifactPreview artifact={artifact({ content: '# Hello world' })} />)
    expect(screen.getByText('Hello world')).toBeTruthy()
    expect(screen.getByText(/Preview \(approximate\)/)).toBeTruthy()
  })

  it('renders sheets content as a table', () => {
    render(<ArtifactPreview artifact={artifact({ type: 'xlsx', format: 'sheets', content: '[{"name":"Sheet1","rows":[["A","B"],["1","2"]]}]' })} />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('renders a pdf via the same-origin proxy iframe', () => {
    // PDFs embed through the same-origin proxy (/api/artifacts/:id/raw), not the
    // cross-origin signed URL — browsers block cross-origin PDFs in an iframe.
    const { container } = render(<ArtifactPreview artifact={artifact({ id: 7, type: 'pdf', downloadUrl: 'signed:plan.pdf' })} />)
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('/api/artifacts/7/raw')
  })
})

describe('ArtifactWorkspace', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })) as never)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the artifact + download, and closes', () => {
    const onClose = vi.fn()
    render(<ArtifactWorkspace artifact={artifact({ title: 'Quarterly Report', type: 'pptx', version: 2 })} onClose={onClose} onChanged={vi.fn()} />)
    expect(screen.getByText('Quarterly Report')).toBeTruthy()
    expect(screen.getByText(/PPTX · v2/)).toBeTruthy()
    fireEvent.click(screen.getByTitle('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('edits source and saves a new version', async () => {
    const onChanged = vi.fn()
    render(<ArtifactWorkspace artifact={artifact()} onClose={vi.fn()} onChanged={onChanged} />)
    fireEvent.click(screen.getByText('Edit'))
    const textarea = screen.getByLabelText('Edit source') as HTMLTextAreaElement
    expect(textarea.value).toBe('# Hello')
    fireEvent.change(textarea, { target: { value: '# Hello v2' } })
    fireEvent.click(screen.getByText('Save version'))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/artifacts/1/edit', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('regenerates via the instruction box', async () => {
    const onChanged = vi.fn()
    render(<ArtifactWorkspace artifact={artifact()} onClose={vi.fn()} onChanged={onChanged} />)
    fireEvent.change(screen.getByLabelText('Regenerate instruction'), { target: { value: 'make it shorter' } })
    fireEvent.click(screen.getByText('Revise'))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/artifacts/1/regenerate', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('lists versions and restores an older one', async () => {
    mockGetVersions.mockResolvedValueOnce([
      { id: 2, version: 2, type: 'docx', title: 'Spec', format: 'markdown', content: 'b', downloadUrl: 's2', createdAt: null },
      { id: 1, version: 1, type: 'docx', title: 'Spec', format: 'markdown', content: 'a', downloadUrl: 's1', createdAt: null },
    ])
    const onChanged = vi.fn()
    render(<ArtifactWorkspace artifact={artifact({ version: 2 })} onClose={vi.fn()} onChanged={onChanged} />)
    fireEvent.click(screen.getByText('Versions'))
    expect(await screen.findByText('v1')).toBeTruthy()
    fireEvent.click(screen.getByTitle('Restore this version'))
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith(1, 1))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})
