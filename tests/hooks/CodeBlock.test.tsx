// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
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
