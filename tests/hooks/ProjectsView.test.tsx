// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ProjectsView } from '@/components/chat/ProjectsView'

afterEach(cleanup)

describe('ProjectsView', () => {
  it('lists projects and selects on click', () => {
    const onSelectProject = vi.fn()
    render(
      <ProjectsView
        projects={[{ id: 3, name: 'Drover_HUB' }]}
        onSelectProject={onSelectProject}
        onDeleteProject={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Drover_HUB'))
    expect(onSelectProject).toHaveBeenCalledWith(3)
  })

  it('requests delete without selecting the project', () => {
    const onSelectProject = vi.fn()
    const onDeleteProject = vi.fn()
    render(
      <ProjectsView
        projects={[{ id: 3, name: 'Drover_HUB' }]}
        onSelectProject={onSelectProject}
        onDeleteProject={onDeleteProject}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete project Drover_HUB' }))
    expect(onDeleteProject).toHaveBeenCalledWith(3)
    expect(onSelectProject).not.toHaveBeenCalled()
  })
})
