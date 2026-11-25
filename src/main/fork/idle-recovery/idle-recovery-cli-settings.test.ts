// Idle recovery (FORK.md): what `orca settings` can and cannot do to it. Agents run that CLI, so
// it may switch the mode on, but it must never be the way a classifier or notify command, or a
// webhook address, comes to exist. With the mode switched on from the CLI and none of those set
// in the Settings screen, a sweep starts no process and calls no address.
import type * as ChildProcess from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/orca-profiles/constants'
import { updateForkSettings, type ForkSettingsCliDeps } from '../settings-cli/settings-cli-apply'
import { listIdleRecoveryCandidatesWith } from './idle-recovery-candidates'
import { clearIdleRecoveryEndingCache, readIdleRecoveryEndingWith } from './idle-recovery-ending'
import { createIdleRecoveryService } from './idle-recovery-service'
import { emptyIdleRecoveryState } from './idle-recovery-state'
import { runIdleRecoverySweep } from './idle-recovery-sweep'
import { NOW, agentRow, fakeHost, psWorktree } from './idle-recovery-test-fixtures'

const spawn = vi.hoisted(() => vi.fn())
// Every way to start a process is the same spy, so one started by another call is seen too.
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcess>()),
  spawn,
  exec: spawn,
  execFile: spawn,
  fork: spawn
}))

const defaults: Record<string, unknown> = { ...getDefaultSettings('/home/someone') }
const RUNS_COMMAND = [
  'forkIdleSweepClassifierCommand',
  'forkInboxNotifyCommand',
  'forkInboxNotifyWebhookUrl'
] as const

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

afterEach(() => {
  vi.unstubAllGlobals()
  spawn.mockReset()
})

describe('orca settings and idle recovery', () => {
  it('may switch the mode and the plain limits', async () => {
    const store = fakeStore()
    const result = await updateForkSettings(store.deps, {
      set: { forkIdleSweepMode: 'wake', forkIdleSweepMaxWakes: 1, forkInboxNotifyDesktop: true }
    })
    expect(result.rejected).toEqual([])
    expect(result.applied).toBe(true)
    expect(store.read()).toMatchObject({ forkIdleSweepMode: 'wake', forkIdleSweepMaxWakes: 1 })
  })

  it.each(RUNS_COMMAND)('refuses to set or reset %s', async (key) => {
    const store = fakeStore({ [key]: 'set-in-the-settings-screen' })
    const set = await updateForkSettings(store.deps, {
      set: { [key]: 'https://example.invalid/x' }
    })
    const reset = await updateForkSettings(store.deps, { reset: [key] })
    for (const result of [set, reset]) {
      expect(result.applied).toBe(false)
      expect(result.rejected).toMatchObject([{ key, reason: /Settings screen/ }])
    }
    expect(store.apply).not.toHaveBeenCalled()
    expect(store.read()[key]).toBe('set-in-the-settings-screen')
  })

  it('writes nothing, not even the mode, when one request names a command too', async () => {
    const store = fakeStore()
    const result = await updateForkSettings(store.deps, {
      set: { forkIdleSweepMode: 'wake', forkIdleSweepClassifierCommand: 'anything' }
    })
    expect(result.applied).toBe(false)
    expect(store.apply).not.toHaveBeenCalled()
    expect(store.read().forkIdleSweepMode).not.toBe('wake')
  })

  it('switched on from the CLI with no command set, a sweep starts no process and calls no address', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    clearIdleRecoveryEndingCache()
    const store = fakeStore()
    await updateForkSettings(store.deps, {
      set: { forkIdleSweepMode: 'wake', forkInboxNotifyDesktop: false }
    })
    const host = fakeHost(
      [
        psWorktree([
          agentRow({ paneKey: 'tab-1:leaf-1', lastAssistantMessage: 'Shall I go on?' }),
          agentRow({ paneKey: 'tab-2:leaf-1', lastAssistantMessage: 'I will run the tests next.' })
        ])
      ],
      {
        terminalStatus: async (paneKey) => ({
          prompt: 'do the thing',
          lastAssistantMessage:
            paneKey === 'tab-1:leaf-1' ? 'Shall I go on?' : 'I will run the tests next.',
          transcriptPath: null
        })
      }
    )
    const wakes: string[] = []
    const state = emptyIdleRecoveryState()
    // The real classifier and notify code: only the chat readers and the send are fakes.
    const service = createIdleRecoveryService({
      now: () => NOW,
      loadState: async () => state,
      saveState: async () => {},
      sweep: (input) =>
        runIdleRecoverySweep({
          ...input,
          deps: {
            listCandidates: (settings, nowMs) =>
              listIdleRecoveryCandidatesWith(host, settings, nowMs),
            readEnding: (candidate) => readIdleRecoveryEndingWith(host, candidate),
            sendWake: async (candidate) => {
              wakes.push(candidate.chatId)
              return true
            }
          }
        }),
      useRuntime: () => {},
      startTimer: () => () => {}
    })
    service.start(() => store.read())
    expect(await service.sweep()).toBe(true)
    // The built-in check lists the question and never calls anything stalled.
    expect((await service.listInbox()).items).toMatchObject([
      { chatId: 'tab-1:leaf-1', verdict: 'waiting_user' }
    ])
    expect(await service.readStatus()).toMatchObject({ classifier: 'builtin', stalled: 0 })
    expect(wakes).toEqual([])
    expect(spawn).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
