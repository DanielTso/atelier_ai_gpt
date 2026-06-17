// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ArtifactCard } from '@/components/chat/ArtifactCard'
import type { ArtifactSummary } from '@/types'

const a: ArtifactSummary = { id: 1, chatId: 3, type: 'xlsx', title: 'Site Schedule', status: 'ready', downloadUrl: 'signed:x', createdAt: null }

describe('ArtifactCard', () => {
  it('shows the title, type label, and a download link', () => {
    render(<ArtifactCard artifact={a} />)
    expect(screen.getByText('Site Schedule')).toBeTruthy()
    expect(screen.getByText(/XLSX/i)).toBeTruthy()
    const link = screen.getByRole('link', { name: /download/i }) as HTMLAnchorElement
    expect(link.href).toContain('signed:x')
  })

  it('renders without a link when downloadUrl is null', () => {
    render(<ArtifactCard artifact={{ ...a, downloadUrl: null }} />)
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull()
  })
})
