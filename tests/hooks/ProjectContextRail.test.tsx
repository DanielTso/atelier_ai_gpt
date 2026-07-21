// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// The rail imports server actions for the suggestions strip; mock them so jsdom
// doesn't pull in the real `db`. Hoisted so the factory can reference the spies.
const { mockGetPending, mockAccept, mockDismiss } = vi.hoisted(() => ({
  mockGetPending: vi.fn(async () => [] as { id: number; text: string; createdAt: null }[]),
  mockAccept: vi.fn(async () => ({ memory: 'Hub\nNew fact' })),
  mockDismiss: vi.fn(async () => undefined),
}))
vi.mock('@/app/actions', () => ({
  getPendingSuggestions: (...a: unknown[]) => mockGetPending(...(a as [])),
  acceptSuggestion: (...a: unknown[]) => mockAccept(...(a as [])),
  dismissSuggestion: (...a: unknown[]) => mockDismiss(...(a as [])),
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ documents: [] }) })) as never)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

import { ProjectContextRail } from '@/components/chat/ProjectContextRail'
import type { DocumentSummary } from '@/types'

const readyDoc = (id: number, filename: string): DocumentSummary => ({
  id, filename, mimeType: 'application/pdf', fileSize: 100, chunkCount: 3,
  status: 'ready', errorMessage: null, url: null, thumbnailUrl: null,
  extractionMethod: 'text', pageCount: 4, failedPages: null, revision: 1, updatedAt: null,
})

function mockDocsFetch(docs: DocumentSummary[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ documents: docs }) })) as never)
}

describe('ProjectContextRail', () => {
  it('renders Memory, Instructions, and Files sections', async () => {
    render(<ProjectContextRail project={{ id: 1, name: 'Drover', memory: 'Hub', instructions: 'Terse' }} onSaveContext={vi.fn()} onAddFiles={vi.fn()} />)
    expect(screen.getByText('Memory')).toBeTruthy()
    expect(screen.getByText('Instructions')).toBeTruthy()
    expect(screen.getByText('Files')).toBeTruthy()
    expect((screen.getByLabelText('Memory') as HTMLTextAreaElement).value).toBe('Hub')
  })

  it('debounce-saves edited memory', async () => {
    vi.useFakeTimers()
    const onSaveContext = vi.fn()
    render(<ProjectContextRail project={{ id: 1, name: 'Drover', memory: '', instructions: '' }} onSaveContext={onSaveContext} onAddFiles={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Memory'), { target: { value: 'New context' } })
    vi.advanceTimersByTime(700)
    vi.useRealTimers()
    await waitFor(() => expect(onSaveContext).toHaveBeenCalledWith(1, { memory: 'New context' }))
  })

  it('renders the suggestions strip with pending facts', async () => {
    mockGetPending.mockResolvedValueOnce([{ id: 7, text: 'PE is Jane Doe', createdAt: null }])
    render(<ProjectContextRail project={{ id: 1, name: 'Drover', memory: 'Hub', instructions: '' }} onSaveContext={vi.fn()} onAddFiles={vi.fn()} />)
    expect(await screen.findByText('PE is Jane Doe')).toBeTruthy()
    expect(screen.getByText(/Suggested memories \(1\)/)).toBeTruthy()
  })

  it('accepts a suggestion and updates the Memory textarea', async () => {
    mockGetPending.mockResolvedValueOnce([{ id: 7, text: 'PE is Jane Doe', createdAt: null }])
    render(<ProjectContextRail project={{ id: 1, name: 'Drover', memory: 'Hub', instructions: '' }} onSaveContext={vi.fn()} onAddFiles={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Accept'))
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith(7, undefined))
    await waitFor(() => expect((screen.getByLabelText('Memory') as HTMLTextAreaElement).value).toBe('Hub\nNew fact'))
  })

  it('dismisses a suggestion', async () => {
    mockGetPending.mockResolvedValueOnce([{ id: 9, text: 'transient', createdAt: null }])
    render(<ProjectContextRail project={{ id: 1, name: 'Drover', memory: '', instructions: '' }} onSaveContext={vi.fn()} onAddFiles={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Dismiss'))
    await waitFor(() => expect(mockDismiss).toHaveBeenCalledWith(9))
    await waitFor(() => expect(screen.queryByText('transient')).toBeNull())
  })

  describe('source scoping', () => {
    it('shows no scoping checkboxes without an onExcludedChange handler', async () => {
      mockDocsFetch([readyDoc(1, 'plan.pdf')])
      render(<ProjectContextRail project={{ id: 1, name: 'Drover', memory: '', instructions: '' }} onSaveContext={vi.fn()} onAddFiles={vi.fn()} />)
      await screen.findByText('plan.pdf')
      expect(screen.queryByLabelText(/Include plan\.pdf/)).toBeNull()
    })

    it('unchecking a source adds its id to the excluded list', async () => {
      mockDocsFetch([readyDoc(1, 'plan.pdf'), readyDoc(2, 'spec.pdf')])
      const onExcludedChange = vi.fn()
      render(
        <ProjectContextRail
          project={{ id: 1, name: 'Drover', memory: '', instructions: '' }}
          onSaveContext={vi.fn()} onAddFiles={vi.fn()}
          excludedDocIds={[]} onExcludedChange={onExcludedChange}
        />,
      )
      const cb = await screen.findByLabelText('Include spec.pdf in grounded answers')
      expect((cb as HTMLInputElement).checked).toBe(true)
      fireEvent.click(cb)
      expect(onExcludedChange).toHaveBeenCalledWith([2])
    })

    it('re-checking an excluded source removes its id', async () => {
      mockDocsFetch([readyDoc(1, 'plan.pdf'), readyDoc(2, 'spec.pdf')])
      const onExcludedChange = vi.fn()
      render(
        <ProjectContextRail
          project={{ id: 1, name: 'Drover', memory: '', instructions: '' }}
          onSaveContext={vi.fn()} onAddFiles={vi.fn()}
          excludedDocIds={[2]} onExcludedChange={onExcludedChange}
        />,
      )
      const cb = await screen.findByLabelText('Include spec.pdf in grounded answers')
      expect((cb as HTMLInputElement).checked).toBe(false)
      fireEvent.click(cb)
      expect(onExcludedChange).toHaveBeenCalledWith([])
    })

    it('shows an "N of M sources active" header when any source is excluded', async () => {
      mockDocsFetch([readyDoc(1, 'plan.pdf'), readyDoc(2, 'spec.pdf')])
      render(
        <ProjectContextRail
          project={{ id: 1, name: 'Drover', memory: '', instructions: '' }}
          onSaveContext={vi.fn()} onAddFiles={vi.fn()}
          excludedDocIds={[2]} onExcludedChange={vi.fn()}
        />,
      )
      expect(await screen.findByText('1 of 2 sources active')).toBeTruthy()
    })
  })
})
