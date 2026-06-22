// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ProjectsView } from '@/components/chat/ProjectsView'

// Radix DropdownMenu needs these pointer APIs which jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

const PROJECTS = [
  { id: 3, name: 'Drover_HUB', memory: 'Man camp logistics', createdAt: new Date('2026-05-13'), updatedAt: new Date('2026-05-20') },
  { id: 4, name: 'CapRock_HUB', memory: 'Google data center', createdAt: new Date('2026-04-27'), updatedAt: new Date('2026-04-30') },
]

function renderView(overrides: Partial<React.ComponentProps<typeof ProjectsView>> = {}) {
  const props = {
    projects: PROJECTS,
    onSelectProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onRenameProject: vi.fn(),
    onNewProject: vi.fn(),
    ...overrides,
  }
  render(<ProjectsView {...props} />)
  return props
}

// Open the kebab menu for a given project name.
function openMenu(projectName: string) {
  const trigger = screen.getByRole('button', { name: `Project options for ${projectName}` })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.pointerUp(trigger)
}

describe('ProjectsView', () => {
  it('lists projects with descriptions and selects on card click', () => {
    const { onSelectProject } = renderView()
    expect(screen.getByText('Man camp logistics')).toBeTruthy()
    fireEvent.click(screen.getByText('Drover_HUB'))
    expect(onSelectProject).toHaveBeenCalledWith(3)
  })

  it('filters projects via search', () => {
    renderView()
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'caprock' } })
    expect(screen.queryByText('Drover_HUB')).toBeNull()
    expect(screen.getByText('CapRock_HUB')).toBeTruthy()
  })

  it('calls onNewProject from the header button', () => {
    const { onNewProject } = renderView()
    fireEvent.click(screen.getByRole('button', { name: /new project/i }))
    expect(onNewProject).toHaveBeenCalled()
  })

  it('requests delete from the kebab menu without selecting the project', () => {
    const { onDeleteProject, onSelectProject } = renderView()
    openMenu('Drover_HUB')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onDeleteProject).toHaveBeenCalledWith(3)
    expect(onSelectProject).not.toHaveBeenCalled()
  })

  it('requests rename from the kebab menu', () => {
    const { onRenameProject } = renderView()
    openMenu('Drover_HUB')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(onRenameProject).toHaveBeenCalledWith(3)
  })

  it('shows an empty state with a create button when there are no projects', () => {
    const { onNewProject } = renderView({ projects: [] })
    expect(screen.getByText('No projects yet.')).toBeTruthy()
    // Header + empty-state both expose a "New project" button; click the empty-state one.
    const buttons = screen.getAllByRole('button', { name: /new project/i })
    fireEvent.click(buttons[buttons.length - 1]!)
    expect(onNewProject).toHaveBeenCalled()
  })
})
