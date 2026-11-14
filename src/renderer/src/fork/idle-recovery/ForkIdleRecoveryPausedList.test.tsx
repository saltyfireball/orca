// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

const tabs = {
  wt1: [
    {
      id: 'tab-1',
      entityId: 'session-1',
      contentType: 'agent-session',
      label: 'Fix the importer',
      customLabel: null
    }
  ]
}

vi.mock('../../store/index', () => ({
  useAppStore: <T,>(select: (state: { unifiedTabsByWorktree: typeof tabs }) => T): T =>
    select({ unifiedTabsByWorktree: tabs })
}))

const { ForkIdleRecoveryPausedList, pausedChatTitle } = await import('./ForkIdleRecoveryPausedList')

afterEach(cleanup)

function renderList(paused: string[]) {
  const updateSettings = vi.fn()
  const settings = { forkIdleSweepMode: 'inbox', forkIdleSweepPaused: paused }
  const view = render(
    <ForkIdleRecoveryPausedList
      settings={settings as unknown as GlobalSettings}
      updateSettings={updateSettings}
    />
  )
  return { updateSettings, view }
}

describe('ForkIdleRecoveryPausedList', () => {
  it('says none are paused', () => {
    const { view } = renderList([])
    expect(view.container.textContent).toContain('None')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('names each paused chat and resumes one', () => {
    const { updateSettings, view } = renderList(['session-1', 'session-2'])
    expect(view.container.textContent).toContain('Fix the importer')
    expect(view.container.textContent).toContain('session-2')
    fireEvent.click(screen.getByRole('button', { name: 'Resume recovery for Fix the importer' }))
    expect(updateSettings).toHaveBeenCalledWith({ forkIdleSweepPaused: ['session-2'] })
  })

  it('resumes all', () => {
    const { updateSettings } = renderList(['session-1', 'session-2'])
    fireEvent.click(screen.getByRole('button', { name: 'Resume all (2)' }))
    expect(updateSettings).toHaveBeenCalledWith({ forkIdleSweepPaused: [] })
  })
})

describe('pausedChatTitle', () => {
  it('finds a chat by session id and nothing for an unknown id', () => {
    expect(pausedChatTitle(tabs as never, 'session-1')).toBe('Fix the importer')
    expect(pausedChatTitle(tabs as never, 'nope')).toBeNull()
    expect(pausedChatTitle(undefined, 'session-1')).toBeNull()
  })
})
