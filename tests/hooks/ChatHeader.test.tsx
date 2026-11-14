// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
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

describe('ChatHeader project menu', () => {
  beforeAll(() => {
    // Radix DropdownMenu needs these pointer APIs which jsdom does not implement.
    Element.prototype.hasPointerCapture = vi.fn()
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('opens the chat\'s project settings from the project chat menu', () => {
    const onOpenProjectSettings = vi.fn()
    render(
      <ChatHeader
        chatId={1}
        chatTitle="Plan Chat"
        projectId={7}
        projectName="Drover"
        onOpenProjectSettings={onOpenProjectSettings}
      />
    )
    const trigger = screen.getByRole('button', { name: 'Project options for Drover' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.pointerUp(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project settings' }))
    expect(onOpenProjectSettings).toHaveBeenCalledWith(7)
  })

  it('has no project menu on a quick chat', () => {
    render(<ChatHeader chatId={2} chatTitle="Random" projectId={null} projectName={null} onOpenProjectSettings={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /project options/i })).toBeNull()
  })
})
