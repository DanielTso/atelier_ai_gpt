// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/app/actions', () => ({
  getSetting: vi.fn(),
  setSettings: vi.fn(),
}))
const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) } }))

import { getSetting, setSettings } from '@/app/actions'
import { ModelDefaultsSettingsTab } from '@/components/settings/ModelDefaultsSettingsTab'

const mockGetSetting = getSetting as ReturnType<typeof vi.fn>
const mockSetSettings = setSettings as ReturnType<typeof vi.fn>

describe('ModelDefaultsSettingsTab — save feedback (U17)', () => {
  beforeEach(() => {
    localStorage.clear()
    mockGetSetting.mockReset().mockResolvedValue(null)
    mockSetSettings.mockReset().mockResolvedValue(undefined)
    toastError.mockReset()
    toastSuccess.mockReset()
  })

  it('confirms a successful save and tells the page', async () => {
    const onSettingsChanged = vi.fn()
    render(<ModelDefaultsSettingsTab models={[]} onSettingsChanged={onSettingsChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: /save defaults/i }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Defaults saved'))
    expect(onSettingsChanged).toHaveBeenCalled()
  })

  it('says so when the save fails, and does not report a change', async () => {
    mockSetSettings.mockRejectedValueOnce(new Error('db down'))
    const onSettingsChanged = vi.fn()
    render(<ModelDefaultsSettingsTab models={[]} onSettingsChanged={onSettingsChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: /save defaults/i }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't save the defaults"))
    expect(onSettingsChanged).not.toHaveBeenCalled()
  })

  it('still renders the form when loading the saved defaults fails', async () => {
    mockGetSetting.mockRejectedValue(new Error('db down'))
    render(<ModelDefaultsSettingsTab models={[]} />)
    expect(await screen.findByRole('button', { name: /save defaults/i })).toBeTruthy()
  })
})
