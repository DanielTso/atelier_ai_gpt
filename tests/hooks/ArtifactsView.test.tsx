// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

vi.mock('@/app/actions', () => ({
  getAllArtifacts: vi.fn(async () => ([
    { id: 1, chatId: 2, type: 'xlsx', title: 'Schedule', status: 'ready', downloadUrl: 'http://x/s.xlsx', createdAt: null, chatTitle: 'Planning', projectName: null },
  ])),
  createBlankArtifact: vi.fn(async () => ({ artifactId: 2 })),
}))

vi.mock('@/components/chat/ArtifactThumbnail', () => ({
  ArtifactThumbnail: () => <div data-testid="artifact-thumbnail" />,
}))

vi.mock('@/components/chat/ArtifactWorkspace', () => ({
  ArtifactWorkspace: () => <div data-testid="artifact-workspace" />,
}))

afterEach(cleanup)
import { ArtifactsView } from '@/components/chat/ArtifactsView'

describe('ArtifactsView', () => {
  it('renders a gallery card for each fetched artifact', async () => {
    render(<ArtifactsView />)
    // The card (ArtifactGalleryCard) really mounted: title, its thumbnail, and the
    // xlsx -> "Spreadsheet" type label from ARTIFACT_TYPE_LABELS all appear.
    await waitFor(() => expect(screen.getByText('Schedule')).toBeTruthy())
    expect(screen.getByTestId('artifact-thumbnail')).toBeTruthy()
    expect(screen.getByText('Spreadsheet')).toBeTruthy()
  })

  it('filters the grid by the search query', async () => {
    render(<ArtifactsView />)
    await waitFor(() => expect(screen.getByText('Schedule')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('Search artifacts...'), { target: { value: 'nonmatching' } })
    expect(screen.queryByText('Schedule')).toBeNull()
    expect(screen.getByText('No artifacts match your search.')).toBeTruthy()
  })
})
