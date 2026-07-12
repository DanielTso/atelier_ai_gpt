// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

const codeToHtmlSafeMock = vi.fn()
vi.mock('@/lib/highlighter', () => ({ codeToHtmlSafe: (...a: unknown[]) => codeToHtmlSafeMock(...a) }))

import { ArtifactPreview } from '@/components/chat/ArtifactPreview'
import { ARTIFACT_TYPE_LABELS } from '@/types'

afterEach(() => { cleanup(); codeToHtmlSafeMock.mockReset() })

const codeArtifact = {
  id: 1, chatId: 1, type: 'code', title: 'deploy script', status: 'ready',
  downloadUrl: null, createdAt: null, format: 'bash', content: 'echo "hi"', version: 1,
}

describe('ArtifactPreview code branch', () => {
  it('renders highlighted code when shiki resolves', async () => {
    codeToHtmlSafeMock.mockResolvedValue('<pre class="shiki"><code>echo</code></pre>')
    render(<ArtifactPreview artifact={codeArtifact} />)
    await waitFor(() => expect(document.querySelector('.shiki')).toBeTruthy())
    expect(codeToHtmlSafeMock).toHaveBeenCalledWith('echo "hi"', 'bash')
  })
  it('falls back to a plain pre when highlighting is unavailable', async () => {
    codeToHtmlSafeMock.mockResolvedValue(null)
    render(<ArtifactPreview artifact={codeArtifact} />)
    await waitFor(() => expect(codeToHtmlSafeMock).toHaveBeenCalled())
    expect(screen.getByText('echo "hi"')).toBeTruthy()
  })
  it('labels code artifacts', () => {
    expect(ARTIFACT_TYPE_LABELS.code).toBe('Code')
  })
})
