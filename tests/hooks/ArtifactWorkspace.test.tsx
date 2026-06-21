// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ArtifactSummary } from '@/types'
import { ArtifactPreview } from '@/components/chat/ArtifactPreview'
import { ArtifactWorkspace } from '@/components/chat/ArtifactWorkspace'

afterEach(() => cleanup())

function artifact(over: Partial<ArtifactSummary> = {}): ArtifactSummary {
  return {
    id: 1, chatId: 1, type: 'docx', title: 'Spec', status: 'ready',
    downloadUrl: 'signed:doc.docx', createdAt: null, format: 'markdown', content: '# Hello', version: 1,
    ...over,
  }
}

describe('ArtifactPreview', () => {
  it('renders markdown source as HTML (approximate)', () => {
    render(<ArtifactPreview artifact={artifact({ content: '# Hello world' })} />)
    expect(screen.getByText('Hello world')).toBeTruthy()
    expect(screen.getByText(/Preview \(approximate\)/)).toBeTruthy()
  })

  it('renders sheets content as a table', () => {
    render(<ArtifactPreview artifact={artifact({ type: 'xlsx', format: 'sheets', content: '[{"name":"Sheet1","rows":[["A","B"],["1","2"]]}]' })} />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('B')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('renders a pdf via iframe of the signed url', () => {
    const { container } = render(<ArtifactPreview artifact={artifact({ type: 'pdf', downloadUrl: 'signed:plan.pdf' })} />)
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe?.getAttribute('src')).toBe('signed:plan.pdf')
  })
})

describe('ArtifactWorkspace', () => {
  it('shows the artifact and a download link, and closes', () => {
    const onClose = vi.fn()
    render(<ArtifactWorkspace artifact={artifact({ title: 'Quarterly Report', type: 'pptx', version: 2 })} onClose={onClose} />)
    expect(screen.getByText('Quarterly Report')).toBeTruthy()
    expect(screen.getByText(/PPTX · v2/)).toBeTruthy()
    expect((screen.getByText('Download').closest('a') as HTMLAnchorElement).getAttribute('href')).toBe('signed:doc.docx')
    fireEvent.click(screen.getByTitle('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})
