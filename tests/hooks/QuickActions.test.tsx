// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QuickActions } from '@/components/chat/QuickActions'

afterEach(cleanup)

describe('QuickActions', () => {
  it('renders four chips and fires the matching handler', () => {
    const onNewProject = vi.fn(), onUpload = vi.fn(), onWrite = vi.fn(), onCode = vi.fn()
    render(<QuickActions onNewProject={onNewProject} onUpload={onUpload} onWrite={onWrite} onCode={onCode} />)
    fireEvent.click(screen.getByRole('button', { name: /new project/i }))
    fireEvent.click(screen.getByRole('button', { name: /upload/i }))
    fireEvent.click(screen.getByRole('button', { name: /write/i }))
    fireEvent.click(screen.getByRole('button', { name: /code/i }))
    expect(onNewProject).toHaveBeenCalledOnce()
    expect(onUpload).toHaveBeenCalledOnce()
    expect(onWrite).toHaveBeenCalledOnce()
    expect(onCode).toHaveBeenCalledOnce()
  })
})
