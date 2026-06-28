// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react'

// --- Mocks (must be before any imports that use them) ---

vi.mock('@/app/actions', () => ({
  getGeneratedImages: vi.fn(async () => ([
    {
      id: 1,
      projectId: null,
      prompt: 'A red sunset over mountains',
      aspectRatio: '1:1',
      mediaType: 'image/webp',
      url: 'https://example.com/img1.webp',
      fileSize: 12345,
      createdAt: new Date('2026-06-28'),
    },
    {
      id: 2,
      projectId: 3,
      prompt: 'Blueprint of a steel frame building',
      aspectRatio: '16:9',
      mediaType: 'image/webp',
      url: 'https://example.com/img2.webp',
      fileSize: 67890,
      createdAt: new Date('2026-06-27'),
    },
  ])),
  deleteGeneratedImage: vi.fn(async () => {}),
}))

afterEach(cleanup)

import { ImagesView } from '@/components/chat/ImagesView'
import { getGeneratedImages } from '@/app/actions'

const PROJECTS = [
  { id: 3, name: 'Drover_HUB' },
  { id: 4, name: 'CapRock_HUB' },
]

describe('ImagesView', () => {
  beforeEach(() => {
    vi.mocked(getGeneratedImages).mockClear()
    // Reset to a fresh resolved value
    vi.mocked(getGeneratedImages).mockResolvedValue([
      {
        id: 1, projectId: null, prompt: 'A red sunset over mountains',
        aspectRatio: '1:1', mediaType: 'image/webp',
        url: 'https://example.com/img1.webp', fileSize: 12345, createdAt: new Date('2026-06-28'),
      },
      {
        id: 2, projectId: 3, prompt: 'Blueprint of a steel frame building',
        aspectRatio: '16:9', mediaType: 'image/webp',
        url: 'https://example.com/img2.webp', fileSize: 67890, createdAt: new Date('2026-06-27'),
      },
    ])
  })

  it('renders seeded images in the gallery', async () => {
    render(<ImagesView projects={PROJECTS} />)
    await waitFor(() => expect(screen.getByText('A red sunset over mountains')).toBeTruthy())
    expect(screen.getByText('Blueprint of a steel frame building')).toBeTruthy()
  })

  it('posts to /api/images/generate and prepends the returned image', async () => {
    const newImage = {
      id: 99, projectId: null, prompt: 'New generated image',
      aspectRatio: '1:1', mediaType: 'image/webp',
      url: 'https://example.com/new.webp', fileSize: 1000, createdAt: new Date(),
    }
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ image: newImage }),
    } as Response))

    render(<ImagesView projects={PROJECTS} />)
    await waitFor(() => expect(screen.getByText('A red sunset over mountains')).toBeTruthy())

    const textarea = screen.getByPlaceholderText('Describe the image you want to generate...')
    fireEvent.change(textarea, { target: { value: 'New generated image' } })
    const generateButton = screen.getByRole('button', { name: /generate/i })
    await act(async () => { fireEvent.click(generateButton) })

    await waitFor(() => expect(screen.getByText('New generated image')).toBeTruthy())
    expect(global.fetch).toHaveBeenCalledWith('/api/images/generate', expect.objectContaining({
      method: 'POST',
    }))
  })

  it('shows the no-key hint on 503 from generate', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response))

    render(<ImagesView projects={PROJECTS} />)
    await waitFor(() => expect(screen.getByText('A red sunset over mountains')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText('Describe the image you want to generate...'), { target: { value: 'test' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /generate/i })) })

    await waitFor(() => expect(screen.getByText(/No Gemini API key configured/i)).toBeTruthy())
  })

  it('re-calls getGeneratedImages with the right arg when filter changes', async () => {
    render(<ImagesView projects={PROJECTS} />)
    await waitFor(() => expect(screen.getByText('A red sunset over mountains')).toBeTruthy())

    const callsBefore = vi.mocked(getGeneratedImages).mock.calls.length

    // Filter to standalone (null)
    fireEvent.click(screen.getByRole('button', { name: 'Standalone' }))
    await waitFor(() => expect(vi.mocked(getGeneratedImages).mock.calls.length).toBeGreaterThan(callsBefore))
    const standaloneCall = vi.mocked(getGeneratedImages).mock.calls.at(-1)!
    expect(standaloneCall[0]).toBeNull()

    // Filter to a specific project (id=3)
    fireEvent.click(screen.getByRole('button', { name: 'Drover_HUB' }))
    await waitFor(() => expect(vi.mocked(getGeneratedImages).mock.calls.length).toBeGreaterThan(callsBefore + 1))
    const projectCall = vi.mocked(getGeneratedImages).mock.calls.at(-1)!
    expect(projectCall[0]).toBe(3)

    // Filter to All (undefined)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(vi.mocked(getGeneratedImages).mock.calls.length).toBeGreaterThan(callsBefore + 2))
    const allCall = vi.mocked(getGeneratedImages).mock.calls.at(-1)!
    expect(allCall[0]).toBeUndefined()
  })
})
