// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ArtifactGalleryCard } from '@/components/chat/ArtifactGalleryCard'
import type { ArtifactSummary } from '@/types'

// Polyfill IntersectionObserver for jsdom
beforeEach(() => {
  if (typeof global.IntersectionObserver === 'undefined') {
    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
  }
})

const art: ArtifactSummary = {
  id: 7, chatId: 3, type: 'pdf', title: 'Quarterly Report', status: 'ready',
  downloadUrl: 'https://signed/x.pdf', createdAt: new Date(), editedAt: new Date(),
  chatTitle: 'Finance chat', projectName: null, format: 'markdown', content: '# Q', version: 2,
}

describe('ArtifactGalleryCard', () => {
  it('shows title, type label and source chip', () => {
    render(<ArtifactGalleryCard artifact={art} onOpen={() => {}} />)
    expect(screen.getByText('Quarterly Report')).toBeTruthy()
    expect(screen.getByText('PDF')).toBeTruthy()
    expect(screen.getByText('Finance chat')).toBeTruthy()
  })

  it('calls onOpen when the card body is clicked', () => {
    const onOpen = vi.fn()
    render(<ArtifactGalleryCard artifact={art} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('Quarterly Report'))
    expect(onOpen).toHaveBeenCalledWith(7)
  })

  it('source chip click opens the chat and does not open the artifact', () => {
    const onOpen = vi.fn(); const onOpenChat = vi.fn()
    render(<ArtifactGalleryCard artifact={art} onOpen={onOpen} onOpenChat={onOpenChat} />)
    fireEvent.click(screen.getByText('Finance chat'))
    expect(onOpenChat).toHaveBeenCalledWith(3)
    expect(onOpen).not.toHaveBeenCalled()
  })
})
