// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QuickActions } from '@/components/chat/QuickActions'

afterEach(cleanup)

describe('QuickActions', () => {
  it('renders the construction starter chips and fires the matching handler', () => {
    const onNewProject = vi.fn(), onAddDocuments = vi.fn(), onDraftRfi = vi.fn(), onLookahead = vi.fn()
    render(
      <QuickActions
        onNewProject={onNewProject}
        onAddDocuments={onAddDocuments}
        onDraftRfi={onDraftRfi}
        onLookahead={onLookahead}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /new project/i }))
    fireEvent.click(screen.getByRole('button', { name: /add documents/i }))
    fireEvent.click(screen.getByRole('button', { name: /draft rfi/i }))
    fireEvent.click(screen.getByRole('button', { name: /3-week look-ahead/i }))
    expect(onNewProject).toHaveBeenCalledOnce()
    expect(onAddDocuments).toHaveBeenCalledOnce()
    expect(onDraftRfi).toHaveBeenCalledOnce()
    expect(onLookahead).toHaveBeenCalledOnce()
  })
})
