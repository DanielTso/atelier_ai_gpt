// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ documents: [] }) })) as never)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

import { ProjectContextRail } from '@/components/chat/ProjectContextRail'

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
})
