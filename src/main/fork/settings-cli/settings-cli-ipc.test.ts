// Settings from the CLI (FORK.md): a CLI write goes through the app's real `settings:set`
// handler, so the handler's own guards hold even for an update that skipped the CLI's checks.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  browserWindowGetAllWindowsMock,
  confirmBrowserPasswordOwnerMock,
  handleMock,
  sanitizeDirectoryMock,
  store,
  type SettingsChangedListener
} from '../../ipc/settings-ipc-test-fixture'
import { registerSettingsHandlers } from '../../ipc/settings'
import { getDefaultSettings } from '../../../shared/constants'
import { forkApplyThroughSettingsSet, updateForkSettings } from './settings-cli-apply'

const defaults: Record<string, unknown> = { ...getDefaultSettings('/home/someone') }

function register(start: Record<string, unknown> = {}): void {
  store.getSettings.mockReturnValue({ ...defaults, ...start })
  store.updateSettings.mockImplementation((updates) => {
    const next = { ...store.getSettings(), ...updates }
    store.getSettings.mockReturnValue(next)
    return next
  })
  registerSettingsHandlers(store as never)
}

describe('a CLI settings write through settings:set', () => {
  beforeEach(() => {
    handleMock.mockClear()
    store.getSettings.mockReset()
    store.updateSettings.mockReset()
    store.updateSettingsAndFlush.mockReset()
    store.onSettingsChanged.mockClear()
    confirmBrowserPasswordOwnerMock.mockReset().mockResolvedValue(true)
    sanitizeDirectoryMock.mockReset().mockResolvedValue('')
    browserWindowGetAllWindowsMock.mockReset().mockReturnValue([])
  })

  it('is the handler the app registers for its own windows', async () => {
    register()
    const registered = handleMock.mock.calls.filter(([channel]) => channel === 'settings:set')
    expect(registered).toHaveLength(1)
    await forkApplyThroughSettingsSet({ terminalFontSize: 18 })
    expect(store.updateSettings).toHaveBeenCalledTimes(1)
    const [written, options] = store.updateSettings.mock.calls[0]
    expect(written).toMatchObject({ terminalFontSize: 18 })
    // No window has this id, so no window is skipped as "the one that made the change".
    expect(options).toEqual({ notifyListeners: true, originWebContentsId: -1 })
  })

  it('tells every open window', async () => {
    register()
    const sent: [number, string, unknown][] = []
    const windows = [1, 2].map((id) => ({
      isDestroyed: () => false,
      webContents: {
        id,
        send: (channel: string, payload: unknown) => sent.push([id, channel, payload])
      }
    }))
    browserWindowGetAllWindowsMock.mockReturnValue(windows)
    const listener = store.onSettingsChanged.mock.calls.at(-1)?.[0] as SettingsChangedListener
    store.updateSettings.mockImplementation((updates, options) => {
      listener(updates, {}, options.originWebContentsId)
      return { ...store.getSettings(), ...updates }
    })
    await forkApplyThroughSettingsSet({ terminalFontSize: 18 })
    expect(sent.map(([id, channel]) => [id, channel])).toEqual([
      [1, 'settings:changed'],
      [2, 'settings:changed']
    ])
  })

  it('still drops the guarded keys from an update that names them', async () => {
    register()
    await forkApplyThroughSettingsSet({
      terminalFontSize: 18,
      activeRuntimeEnvironmentId: 'env-1',
      floatingTerminalTrustedCwds: ['/somewhere'],
      pluginConsents: { some: 'grant' },
      disabledPlugins: [],
      pluginExternalHostGrants: { some: ['host'] },
      antigravityChatAuth: { any: 'thing' }
    })
    const [written] = store.updateSettings.mock.calls[0]
    expect(written).toMatchObject({ terminalFontSize: 18 })
    for (const key of [
      'activeRuntimeEnvironmentId',
      'floatingTerminalTrustedCwds',
      'pluginConsents',
      'disabledPlugins',
      'pluginExternalHostGrants',
      'antigravityChatAuth'
    ]) {
      expect(written, key).not.toHaveProperty(key)
    }
  })

  it('cannot turn off password fill protection without the owner check', async () => {
    register({ browserPasswordsFillRequiresReauth: true })
    confirmBrowserPasswordOwnerMock.mockResolvedValue(false)
    await forkApplyThroughSettingsSet({ browserPasswordsFillRequiresReauth: false })
    expect(store.getSettings().browserPasswordsFillRequiresReauth).toBe(true)
  })

  it('carries a whole `orca settings` request: checked, written once, read back', async () => {
    register()
    const deps = {
      getSettings: () => store.getSettings() as Record<string, unknown>,
      getDefaults: () => defaults,
      apply: forkApplyThroughSettingsSet
    }
    const refused = await updateForkSettings(deps, {
      set: { terminalFontSize: 18, pluginConsents: { some: 'grant' } }
    })
    expect(refused.applied).toBe(false)
    expect(store.updateSettings).not.toHaveBeenCalled()
    const done = await updateForkSettings(deps, { set: { terminalFontSize: 18 } })
    expect(done).toMatchObject({ applied: true, rejected: [] })
    expect(store.getSettings().terminalFontSize).toBe(18)
  })
})
