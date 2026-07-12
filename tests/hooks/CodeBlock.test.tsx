// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const codeToHtmlSafeMock = vi.fn()
vi.mock('@/lib/highlighter', () => ({
  codeToHtmlSafe: (...a: unknown[]) => codeToHtmlSafeMock(...a),
}))

import { CodeBlock } from '@/components/chat/CodeBlock'

describe('CodeBlock copy button', () => {
  let writeText: ReturnType<typeof vi.fn>
  beforeEach(() => {
    cleanup()
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('copies THIS block, not the first code block on the page', async () => {
    render(
      <div>
        <CodeBlock><code>FIRST block</code></CodeBlock>
        <CodeBlock><code>SECOND block</code></CodeBlock>
      </div>
    )
    const buttons = screen.getAllByTitle('Copy code')
    expect(buttons).toHaveLength(2)
    // Click the SECOND block's button — it must copy its own contents, not the first's
    // (the regression: a document-wide querySelector always grabbed the first block).
    fireEvent.click(buttons[1]!)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SECOND block'))
    expect(writeText).not.toHaveBeenCalledWith('FIRST block')
  })

  it('shows the Copied! state after a successful copy', async () => {
    render(<CodeBlock><code>hello</code></CodeBlock>)
    fireEvent.click(screen.getByTitle('Copy code'))
    await waitFor(() => expect(screen.getByTitle('Copied!')).toBeTruthy())
  })
})

describe('CodeBlock highlighting', () => {
  beforeEach(() => {
    cleanup()
    codeToHtmlSafeMock.mockReset()
  })

  it('renders plain pre immediately, then swaps in highlighted HTML', async () => {
    codeToHtmlSafeMock.mockResolvedValue('<pre class="shiki"><code><span style="color:#B07D48">hi</span></code></pre>')
    render(
      <CodeBlock className="language-python">
        <code className="language-python">print(&apos;hi&apos;)</code>
      </CodeBlock>
    )
    expect(screen.getByText("print('hi')")).toBeTruthy()
    await waitFor(() => expect(document.querySelector('.shiki')).toBeTruthy(), { timeout: 2000 })
    expect(codeToHtmlSafeMock).toHaveBeenCalledWith("print('hi')", 'python')
  })

  it('keeps the plain pre when the language is unsupported', async () => {
    codeToHtmlSafeMock.mockResolvedValue(null)
    render(
      <CodeBlock className="language-brainfuck">
        <code className="language-brainfuck">+++</code>
      </CodeBlock>
    )
    await waitFor(() => expect(codeToHtmlSafeMock).toHaveBeenCalled(), { timeout: 2000 })
    expect(document.querySelector('.shiki')).toBeNull()
    expect(screen.getByText('+++')).toBeTruthy()
  })

  it('copy button copies from the highlighted rendering too', async () => {
    codeToHtmlSafeMock.mockResolvedValue('<pre class="shiki"><code>copied-content</code></pre>')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(
      <CodeBlock className="language-python">
        <code className="language-python">copied-content</code>
      </CodeBlock>
    )
    await waitFor(() => expect(document.querySelector('.shiki')).toBeTruthy(), { timeout: 2000 })
    fireEvent.click(screen.getByTitle('Copy code'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('copied-content'))
  })
})
