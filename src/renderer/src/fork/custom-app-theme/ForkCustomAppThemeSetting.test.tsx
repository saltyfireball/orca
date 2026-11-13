// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { CYBERDREAM_EXAMPLE_TEXT } from '../../../../shared/fork/custom-app-theme/cyberdream-example'
import { importCustomAppTheme } from '../../../../shared/fork/custom-app-theme/custom-app-theme-import'
import { ForkCustomAppThemeSetting } from './ForkCustomAppThemeSetting'

vi.mock('@/hooks/use-document-dark-theme', () => ({ useSettingsDarkTheme: () => true }))
vi.mock('../../components/settings/section-layout/SearchableSetting', () => ({
  SearchableSetting: ({ children }: { children: React.ReactNode }) => children
}))

afterEach(cleanup)

function renderSetting(settings: Partial<GlobalSettings> = {}) {
  const updateSettings = vi.fn()
  render(
    <ForkCustomAppThemeSetting
      settings={settings as GlobalSettings}
      updateSettings={updateSettings}
    />
  )
  return updateSettings
}

describe('ForkCustomAppThemeSetting', () => {
  it('names what it cannot read and will not save it', () => {
    renderSetting()
    fireEvent.change(screen.getByLabelText('Theme to load'), { target: { value: 'hello there' } })
    expect(screen.getByRole('alert').textContent).toContain('Not a format Orca reads')
    expect(screen.getByText('Save theme').closest('button')?.disabled).toBe(true)
  })

  it('previews the example and saves it without using it', () => {
    const updateSettings = renderSetting()
    fireEvent.click(screen.getByText('Load example (cyberdream)'))
    expect(screen.getByLabelText('Theme preview')).toBeTruthy()
    fireEvent.click(screen.getByText('Save theme'))
    expect(updateSettings).toHaveBeenCalledTimes(1)
    const update = updateSettings.mock.calls[0][0] as Partial<GlobalSettings>
    expect(update.forkCustomAppThemes?.[0]).toMatchObject({ id: 'cyberdream', base: 'dark' })
    expect(update.forkCustomAppThemeDark).toBeUndefined()
  })

  it('uses a saved theme with its terminal colors, and resets', () => {
    const parsed = importCustomAppTheme(CYBERDREAM_EXAMPLE_TEXT)
    if (!parsed.ok) {
      throw new Error('example did not parse')
    }
    const saved = { ...parsed.theme, id: 'cyberdream', createdAt: '2026-01-01T00:00:00.000Z' }
    const updateSettings = renderSetting({ forkCustomAppThemes: [saved] })
    expect(screen.getByText('Reset to default').closest('button')?.disabled).toBe(true)
    fireEvent.click(screen.getByText('Use'))
    expect(updateSettings.mock.calls[0][0]).toMatchObject({
      forkCustomAppThemeDark: 'cyberdream',
      terminalThemeDark: 'custom:manual:app-theme-cyberdream'
    })
    cleanup()

    const reset = renderSetting({
      forkCustomAppThemes: [saved],
      forkCustomAppThemeDark: 'cyberdream'
    })
    fireEvent.click(screen.getByText('Reset to default'))
    expect(reset.mock.calls[0][0]).toMatchObject({
      forkCustomAppThemeDark: null,
      forkCustomAppThemeLight: null
    })
  })
})
