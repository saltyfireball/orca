// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { ForkBotRoomHopsSetting } from './ForkBotRoomHopsSetting'

afterEach(cleanup)

function renderCard(stored?: number) {
  const updateSettings = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the card reads only forkBotRoomHopLimit.
  const settings = { forkBotRoomHopLimit: stored } as unknown as GlobalSettings
  render(<ForkBotRoomHopsSetting settings={settings} updateSettings={updateSettings} />)
  return { updateSettings, trigger: screen.getByRole('combobox') }
}

describe('ForkBotRoomHopsSetting', () => {
  it('shows the default, saves a choice, and offers No limit as 0', () => {
    const { updateSettings, trigger } = renderCard()
    expect(trigger.textContent).toBe('6')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'No limit',
      '3',
      '6',
      '10',
      '20'
    ])
    fireEvent.click(screen.getByRole('option', { name: 'No limit' }))
    expect(updateSettings).toHaveBeenCalledWith({ forkBotRoomHopLimit: 0 })
  })

  it('keeps a stored limit that is not one of the choices', () => {
    const { trigger } = renderCard(4)
    expect(trigger.textContent).toBe('4')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toContain('4')
  })
})
