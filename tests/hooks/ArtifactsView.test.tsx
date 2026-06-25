// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

vi.mock('@/app/actions', () => ({
  getAllArtifacts: vi.fn(async () => ([
    { id: 1, chatId: 2, type: 'xlsx', title: 'Schedule', status: 'ready', downloadUrl: 'http://x/s.xlsx', createdAt: null },
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
  it('lists fetched artifacts', async () => {
    render(<ArtifactsView />)
    await waitFor(() => expect(screen.getByText('Schedule')).toBeTruthy())
    expect(screen.getByText('Schedule')).toBeTruthy()
  })
})
