// Settings from the CLI (FORK.md): the host side of `orca settings`, on a fake settings store.
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import {
  forkApplyThroughSettingsSet,
  forkCaptureSettingsSet,
  readForkSettings,
  updateForkSettings,
  type ForkSettingsCliDeps
} from './settings-cli-apply'

const defaults: Record<string, unknown> = { ...getDefaultSettings('/home/someone') }
const SECRET = 'cookie-value-that-must-not-leak'

/** A store whose `apply` merges like the real one, after an optional rewrite by "the app". */
function fakeStore(
  start: Record<string, unknown> = {},
  rewrite: (update: Record<string, unknown>) => Record<string, unknown> = (update) => update
) {
  let settings: Record<string, unknown> = { ...defaults, ...start }
  const apply = vi.fn(async (update: Record<string, unknown>) => {
    settings = { ...settings, ...rewrite(update) }
  })
  const deps: ForkSettingsCliDeps = {
    getSettings: () => settings,
    getDefaults: () => defaults,
    apply
  }
  return { deps, apply, read: () => settings }
}

describe('readForkSettings', () => {
  it('returns values and defaults with every secret taken out', () => {
    const { deps } = fakeStore({ opencodeSessionCookie: SECRET, terminalFontSize: 17 })
    const result = readForkSettings(deps)
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(result.secretsSet).toEqual(['opencodeSessionCookie'])
    expect(result.values.terminalFontSize).toBe(17)
    expect(result.defaults.terminalFontSize).toBe(defaults.terminalFontSize)
  })
})

describe('updateForkSettings', () => {
  it('writes every change in one update', async () => {
    const { deps, apply, read } = fakeStore()
    const result = await updateForkSettings(deps, {
      set: { terminalFontSize: 18, theme: 'light' }
    })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith({ terminalFontSize: 18, theme: 'light' })
    expect(read().terminalFontSize).toBe(18)
    expect(result).toEqual({
      applied: true,
      dryRun: false,
      changes: [
        { key: 'terminalFontSize', old: defaults.terminalFontSize, new: 18 },
        { key: 'theme', old: defaults.theme, new: 'light' }
      ],
      rejected: []
    })
  })

  it('writes nothing when any key is refused', async () => {
    const { deps, apply, read } = fakeStore()
    const result = await updateForkSettings(deps, {
      set: { terminalFontSize: 18, nestedWorkerMaxDepth: 99, noSuchSetting: true, theme: 7 }
    })
    expect(apply).not.toHaveBeenCalled()
    expect(read().terminalFontSize).toBe(defaults.terminalFontSize)
    expect(result.applied).toBe(false)
    expect(result.rejected.map((entry) => entry.key)).toEqual([
      'nestedWorkerMaxDepth',
      'noSuchSetting',
      'theme'
    ])
  })

  it('never hands a guarded key to the app', async () => {
    for (const key of [
      'activeRuntimeEnvironmentId',
      'floatingTerminalTrustedCwds',
      'pluginConsents',
      'disabledPlugins',
      'pluginExternalHostGrants',
      'antigravityChatAuth',
      'browserPasswordsFillRequiresReauth'
    ]) {
      const { deps, apply } = fakeStore()
      const set = await updateForkSettings(deps, { set: { [key]: false } })
      const reset = await updateForkSettings(deps, { reset: [key] })
      expect(apply, key).not.toHaveBeenCalled()
      expect(set.rejected[0]?.reason ?? reset.rejected[0]?.reason, key).toMatch(/^read-only: /)
    }
  })

  it('reports a dry run and writes nothing', async () => {
    const { deps, apply } = fakeStore()
    const result = await updateForkSettings(deps, { set: { terminalFontSize: 18 }, dryRun: true })
    expect(apply).not.toHaveBeenCalled()
    expect(result).toMatchObject({ applied: false, dryRun: true })
    expect(result.changes).toHaveLength(1)
  })

  it('does not call the app when nothing differs', async () => {
    const { deps, apply } = fakeStore()
    const result = await updateForkSettings(deps, {
      set: { terminalFontSize: defaults.terminalFontSize },
      reset: ['theme']
    })
    expect(apply).not.toHaveBeenCalled()
    expect(result).toEqual({ applied: false, dryRun: false, changes: [], rejected: [] })
  })

  it('resets to the default and clears a key that has none', async () => {
    const { deps, read } = fakeStore({ terminalFontSize: 18, forkUsageCardPattern: 'X-\\d+' })
    const result = await updateForkSettings(deps, {
      reset: ['terminalFontSize', 'forkUsageCardPattern']
    })
    expect(result.applied).toBe(true)
    expect(read().terminalFontSize).toBe(defaults.terminalFontSize)
    expect(read().forkUsageCardPattern).toBeUndefined()
  })

  it('says so when the app stored something other than what was asked', async () => {
    const adjusted = fakeStore({}, (update) => ({ ...update, terminalFontSize: 16 }))
    expect(
      (await updateForkSettings(adjusted.deps, { set: { terminalFontSize: 500 } })).changes
    ).toEqual([
      {
        key: 'terminalFontSize',
        old: defaults.terminalFontSize,
        new: 16,
        note: 'the app adjusted the value'
      }
    ])
    const kept = fakeStore({}, () => ({}))
    expect((await updateForkSettings(kept.deps, { set: { theme: 'light' } })).changes).toEqual([
      { key: 'theme', old: defaults.theme, new: defaults.theme, note: 'the app kept the old value' }
    ])
  })

  it('takes a secret and shows neither the old nor the new value', async () => {
    const { deps, read } = fakeStore({ opencodeSessionCookie: SECRET })
    const result = await updateForkSettings(deps, { set: { opencodeSessionCookie: 'fresh-one' } })
    expect(read().opencodeSessionCookie).toBe('fresh-one')
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(JSON.stringify(result)).not.toContain('fresh-one')
  })
})

describe('forkApplyThroughSettingsSet', () => {
  it('calls the captured settings:set handler as a sender no window has', async () => {
    const seen: { senderId: number; args: Partial<GlobalSettings> }[] = []
    const handler = async (event: IpcMainInvokeEvent, args: Partial<GlobalSettings>) => {
      seen.push({ senderId: event.sender.id, args })
      return getDefaultSettings('/home/someone')
    }
    // The hook returns the handler it was given, so the app registers the same function.
    expect(forkCaptureSettingsSet(handler)).toBe(handler)
    await forkApplyThroughSettingsSet({ terminalFontSize: 18 })
    expect(seen).toEqual([{ senderId: -1, args: { terminalFontSize: 18 } }])
  })
})
