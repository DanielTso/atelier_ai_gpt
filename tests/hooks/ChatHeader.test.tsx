// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ChatHeader } from '@/components/chat/ChatHeader'

afterEach(cleanup)

describe('ChatHeader breadcrumb', () => {
  it('shows the project name and navigates on click for a project chat', () => {
    const onProjectClick = vi.fn()
    render(
      <ChatHeader
        chatId={1}
        chatTitle="Plan Chat"
        projectName="Drover"
        onProjectClick={onProjectClick}
      />
    )
    expect(screen.getByText('Drover')).toBeTruthy()
    expect(screen.getByText('Plan Chat')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Drover' }))
    expect(onProjectClick).toHaveBeenCalled()
  })

  it('marks a chat with no project as a quick chat', () => {
    render(<ChatHeader chatId={2} chatTitle="Random thoughts" projectName={null} />)
    expect(screen.getByText('Quick chat')).toBeTruthy()
    expect(screen.getByText('Random thoughts')).toBeTruthy()
  })
})
