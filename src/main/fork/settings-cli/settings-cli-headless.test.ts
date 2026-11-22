// Settings from the CLI (FORK.md) on a host with no desktop app: the fork.settings.* methods
// against a real settings store in a temp folder. No app, server or network is contacted.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestStores, createStore, testState } from '../../persistence/persistence-test-harness'
import type { RpcContext } from '../../runtime/rpc/core'
import { FORK_SETTINGS_METHODS } from '../../runtime/rpc/methods/fork/fork-settings'
import type {
  ForkSettingsGetResult,
  ForkSettingsUpdateResult
} from '../../../shared/fork/settings-wire'
import { readBoundaryCompactionSettings } from '../../../shared/fork/boundary-compaction'
import {
  FORK_HEADLESS_REFUSED_SETTING_KEYS,
  forkApplyHeadlessSettings,
  forkHeadlessSettingRefusal,
  forkMarkHeadlessSettingsHost,
  forkSanitizeHeadlessSettingsUpdate
} from './settings-cli-headless'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))

type Store = ReturnType<typeof createStore>

function method(name: string) {
  const found = FORK_SETTINGS_METHODS.find((entry) => entry.name === name)
  if (!found) {
    throw new Error(`no method ${name}`)
  }
  return found
}

function context(store: Store): RpcContext {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the methods use only `runtime.requireStore`.
  return { runtime: { requireStore: () => store } } as unknown as RpcContext
}

async function update(store: Store, params: object): Promise<ForkSettingsUpdateResult> {
  const result = await method('fork.settings.update').handler(params as never, context(store))
  return result as ForkSettingsUpdateResult
}

async function read(store: Store): Promise<ForkSettingsGetResult> {
  const result = await method('fork.settings.get').handler({} as never, context(store))
  return result as ForkSettingsGetResult
}

beforeEach(() => {
  testState.dir = mkdtempSync(join(tmpdir(), 'fork-headless-settings-'))
  forkMarkHeadlessSettingsHost(true)
})

afterEach(async () => {
  forkMarkHeadlessSettingsHost(false)
  await closeTestStores()
  rmSync(testState.dir, { recursive: true, force: true })
})

describe('fork.settings.update on a host with no desktop app', () => {
  it('writes the store, tells its listeners and shows the value on the next read', async () => {
    const store = createStore()
    const heard: Record<string, unknown>[] = []
    store.onSettingsChanged((updates) => heard.push(updates))

    const result = await update(store, {
      set: { forkBoundaryCompactMode: 'on', forkBoundaryCompactThresholdTokens: 90_000 }
    })

    expect(result).toEqual({
      applied: true,
      dryRun: false,
      changes: [
        { key: 'forkBoundaryCompactMode', new: 'on' },
        { key: 'forkBoundaryCompactThresholdTokens', new: 90_000 }
      ],
      rejected: []
    })
    expect(heard).toEqual([
      { forkBoundaryCompactMode: 'on', forkBoundaryCompactThresholdTokens: 90_000 }
    ])
    expect((await read(store)).values).toMatchObject({
      forkBoundaryCompactMode: 'on',
      forkBoundaryCompactThresholdTokens: 90_000
    })
    // What the sweep on this host reads.
    expect(readBoundaryCompactionSettings(store.getSettings())).toMatchObject({
      mode: 'on',
      thresholdTokens: 90_000
    })
  })

  it('keeps the value through a restart of the host', async () => {
    await update(createStore(), { set: { forkBoundaryCompactMode: 'on' } })
    await closeTestStores()

    const restarted = createStore()
    expect(restarted.getSettings().forkBoundaryCompactMode).toBe('on')
    expect((await read(restarted)).values.forkBoundaryCompactMode).toBe('on')

    const reset = await update(restarted, { reset: ['forkBoundaryCompactMode'] })
    expect(reset.applied).toBe(true)
    await closeTestStores()
    expect(createStore().getSettings().forkBoundaryCompactMode).toBeUndefined()
  })

  it('refuses a desktop-only setting by name and then writes nothing of the request', async () => {
    const store = createStore()
    const result = await update(store, {
      set: { forkChatSurvive: true, forkBoundaryCompactMode: 'on' }
    })
    expect(result.applied).toBe(false)
    expect(result.rejected).toEqual([
      { key: 'forkChatSurvive', reason: forkHeadlessSettingRefusal('forkChatSurvive') }
    ])
    expect(result.rejected[0]?.reason).toMatch(/^not on a server without the desktop app: /)
    expect(store.getSettings().forkChatSurvive).toBeUndefined()
    expect(store.getSettings().forkBoundaryCompactMode).toBeUndefined()
  })

  it('names the refusal in a dry run, and leaves an unchanged value alone', async () => {
    const store = createStore()
    const dry = await update(store, { set: { uiLanguage: 'de' }, dryRun: true })
    expect(dry.rejected.map((entry) => entry.key)).toEqual(['uiLanguage'])
    // An exported file names every key; one that already matches is not a change to refuse.
    const same = await update(store, { set: { theme: store.getSettings().theme } })
    expect(same).toEqual({ applied: false, dryRun: false, changes: [], rejected: [] })
  })

  it('still refuses what the CLI may never write', async () => {
    const result = await update(createStore(), {
      set: { nestedWorkerMaxDepth: 99, forkSnoozeSettleCommand: 'true' }
    })
    expect(result.applied).toBe(false)
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      expect.stringMatching(/^read-only: /),
      expect.stringMatching(/^read-only: /)
    ])
  })

  it('answers that the app is still starting on a desktop with no handler yet', async () => {
    forkMarkHeadlessSettingsHost(false)
    const store = createStore()
    await expect(update(store, { set: { forkBoundaryCompactMode: 'on' } })).rejects.toThrow(
      /has not finished starting/
    )
    expect(store.getSettings().forkBoundaryCompactMode).toBeUndefined()
  })
})

describe('forkHeadlessSettingRefusal', () => {
  it('refuses only the settings the desktop app alone acts on', () => {
    expect([...FORK_HEADLESS_REFUSED_SETTING_KEYS].sort()).toEqual([
      'appIcon',
      'computerAwakeMode',
      'floatingTerminalCwd',
      'forkChatSurvive',
      'keepComputerAwakeWhileAgentsRun',
      'theme',
      'uiLanguage'
    ])
    for (const key of [
      'forkBoundaryCompactMode',
      'forkBoundaryCompactThresholdTokens',
      'forkLimitResume',
      'terminalFontSize'
    ]) {
      expect(forkHeadlessSettingRefusal(key), key).toBeNull()
    }
  })
})

describe('forkApplyHeadlessSettings', () => {
  it('stores values the way the settings handler would, minus what only it may write', () => {
    expect(
      forkSanitizeHeadlessSettingsUpdate({
        httpProxyUrl: 'not a url',
        activeRuntimeEnvironmentId: 'other-host',
        floatingTerminalTrustedCwds: ['/somewhere'],
        pluginConsents: {},
        forkChatSurvive: true,
        forkBoundaryCompactIdleSeconds: 300
      } as never)
    ).toEqual({ httpProxyUrl: '', forkBoundaryCompactIdleSeconds: 300 })
  })

  it('waits for the write to land where the store can, else writes and notifies', async () => {
    const flushed = vi.fn(async () => undefined)
    const plain = vi.fn()
    await forkApplyHeadlessSettings(
      { updateSettingsAndFlush: flushed, updateSettings: plain },
      { forkBoundaryCompactMode: 'on' }
    )
    expect(flushed).toHaveBeenCalledWith(
      { forkBoundaryCompactMode: 'on' },
      { notifyListeners: true }
    )
    expect(plain).not.toHaveBeenCalled()

    await forkApplyHeadlessSettings({ updateSettings: plain }, { forkBoundaryCompactMode: 'off' })
    expect(plain).toHaveBeenCalledWith(
      { forkBoundaryCompactMode: 'off' },
      { notifyListeners: true }
    )
    await expect(forkApplyHeadlessSettings({}, { forkBoundaryCompactMode: 'on' })).rejects.toThrow(
      /no settings store/
    )
  })
})
