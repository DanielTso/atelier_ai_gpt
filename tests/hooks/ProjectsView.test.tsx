// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ProjectsView } from '@/components/chat/ProjectsView'

afterEach(cleanup)

describe('ProjectsView', () => {
  it('lists projects and selects on click', () => {
    const onSelectProject = vi.fn()
    render(<ProjectsView projects={[{ id: 3, name: 'Drover_HUB' }]} onSelectProject={onSelectProject} />)
    fireEvent.click(screen.getByText('Drover_HUB'))
    expect(onSelectProject).toHaveBeenCalledWith(3)
  })
})
