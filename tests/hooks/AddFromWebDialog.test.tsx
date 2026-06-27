// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const map = vi.fn()
const ingestUrls = vi.fn()
vi.mock('@/hooks/useWebIngest', () => ({
  useWebIngest: () => ({ mapSite: map, ingestUrl: vi.fn(), ingestUrls, busy: false }),
}))

import { AddFromWebDialog } from '@/components/ui/AddFromWebDialog'

describe('AddFromWebDialog', () => {
  beforeEach(() => { map.mockReset(); ingestUrls.mockReset() })

  it('single-page mode ingests the entered URL', async () => {
    ingestUrls.mockImplementation(async (urls, _pid, onResult) => { onResult({ url: urls[0], document: { id: 1 } }) })
    const onIngested = vi.fn()
    render(<AddFromWebDialog open onOpenChange={() => {}} projectId={1} onIngested={onIngested} />)
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//i), { target: { value: 'https://x.com/a' } })
    fireEvent.click(screen.getByRole('button', { name: /add page/i }))
    await waitFor(() => expect(ingestUrls).toHaveBeenCalledWith(['https://x.com/a'], 1, expect.any(Function), expect.anything()))
    await waitFor(() => expect(onIngested).toHaveBeenCalled())
  })

  it('crawl mode maps then lists discovered pages', async () => {
    map.mockResolvedValue({ urls: ['https://x.com/a', 'https://x.com/b'], configured: true })
    render(<AddFromWebDialog open onOpenChange={() => {}} projectId={1} onIngested={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /crawl site/i }))
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//i), { target: { value: 'https://x.com' } })
    fireEvent.click(screen.getByRole('button', { name: /find pages/i }))
    await waitFor(() => expect(screen.getByText('https://x.com/a')).toBeTruthy())
  })

  it('shows the no-key hint when map returns configured:false', async () => {
    map.mockResolvedValue({ urls: [], configured: false })
    render(<AddFromWebDialog open onOpenChange={() => {}} projectId={1} onIngested={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /crawl site/i }))
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//i), { target: { value: 'https://x.com' } })
    fireEvent.click(screen.getByRole('button', { name: /find pages/i }))
    await waitFor(() => expect(screen.getByText(/Tavily API key/i)).toBeTruthy())
  })
})
