// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }))

afterEach(cleanup)
import { AppearanceSettingsTab } from '@/components/settings/AppearanceSettingsTab'

describe('AppearanceSettingsTab display name', () => {
  it('renders the current name and reports changes', () => {
    const onDisplayNameChange = vi.fn()
    render(
      <AppearanceSettingsTab
        fontSize="medium" onFontSizeChange={vi.fn()}
        messageDensity="comfortable" onMessageDensityChange={vi.fn()}
        displayName="Daniel" onDisplayNameChange={onDisplayNameChange}
      />
    )
    const input = screen.getByLabelText('Display name') as HTMLInputElement
    expect(input.value).toBe('Daniel')
    fireEvent.change(input, { target: { value: 'Dan' } })
    expect(onDisplayNameChange).toHaveBeenCalledWith('Dan')
  })
})
