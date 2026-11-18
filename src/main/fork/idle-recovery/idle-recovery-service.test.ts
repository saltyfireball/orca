import { describe, expect, it, vi } from 'vitest'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import type { ForkBackoffTimerOptions } from '../fork-backoff-timer'
import {
  FORK_IDLE_RECOVERY_IDLE_SWEEP_MS,
  FORK_IDLE_RECOVERY_SWEEP_MS,
  createIdleRecoveryService,
  type IdleRecoveryStore
} from './idle-recovery-service'
import { emptyIdleRecoveryState, type IdleRecoveryStoredState } from './idle-recovery-state'
import { registerForkInboxSource } from './idle-recovery-sources'
import { runIdleRecoverySweep } from './idle-recovery-sweep'
import { fakeSweepWorld, testCandidate, testVerdict } from './idle-recovery-sweep-fixtures'

type Settings = Partial<ForkGlobalSettings>

function harness(initial: Settings = { forkIdleSweepMode: 'wake' }) {
  const world = fakeSweepWorld()
  let settings: Settings = initial
  const settingsListeners: ((updates: Settings) => void)[] = []
  const ctx = {
    world,
    now: 50_000,
    /** What the state file holds. */
    file: emptyIdleRecoveryState() as IdleRecoveryStoredState,
    loads: 0,
    saves: 0,
    timers: [] as { options: ForkBackoffTimerOptions; stopped: boolean }[],
    notified: [] as string[][],
    answers: [] as { chatId: string; text: string }[],
    answerOutcome: 'sent' as 'sent' | 'not-found' | 'not-waiting' | 'unavailable',
    changes: 0,
    store: {
      getSettings: () => settings,
      updateSettings: (updates: Settings) => {
        settings = { ...settings, ...updates }
        for (const listener of settingsListeners) {
          listener(updates)
        }
      },
      onSettingsChanged: (listener: (updates: Settings) => void) => {
        settingsListeners.push(listener)
      }
    } satisfies IdleRecoveryStore,
    set: (updates: Settings) => ctx.store.updateSettings(updates),
    service: createIdleRecoveryService({
      now: () => ctx.now,
      loadState: async () => {
        ctx.loads += 1
        return structuredClone(ctx.file)
      },
      saveState: async (state) => {
        ctx.saves += 1
        ctx.file = structuredClone(state)
      },
      sweep: (input) => runIdleRecoverySweep({ ...input, deps: world.deps }),
      notify: async (items) => {
        ctx.notified.push(items.map((item) => item.chatId))
      },
      sendAnswer: async (chatId, text) => {
        ctx.answers.push({ chatId, text })
        return ctx.answerOutcome
      },
      useRuntime: () => {},
      // No real timer: the test fires `options.run` itself.
      startTimer: (options) => {
        const timer = { options, stopped: false }
        ctx.timers.push(timer)
        return () => {
          timer.stopped = true
        }
      }
    })
  }
  ctx.service.onChanged(() => {
    ctx.changes += 1
  })
  ctx.service.start(ctx.store.getSettings, { store: () => ctx.store })
  return ctx
}

const waiting = testVerdict({ verdict: 'waiting_user', question: 'Which one?' })

describe('idle recovery service', () => {
  it('does nothing while the mode is off: no state read, no chat read, and the timer backs off', async () => {
    const ctx = harness({})
    ctx.world.candidates = [testCandidate()]
    ctx.service.start(ctx.store.getSettings, { store: () => ctx.store })
    expect(ctx.timers).toHaveLength(1)
    expect(ctx.timers[0].options).toMatchObject({
      baseMs: FORK_IDLE_RECOVERY_SWEEP_MS,
      maxMs: FORK_IDLE_RECOVERY_IDLE_SWEEP_MS
    })
    expect(await ctx.timers[0].options.run()).toBe(false)
    expect(await ctx.service.listInbox()).toEqual({ now: 50_000, mode: 'off', items: [] })
    expect(await ctx.service.readStatus()).toMatchObject({
      mode: 'off',
      running: false,
      waiting: 0
    })
    expect(await ctx.service.answer({ chatId: 'chat-1', text: 'x' })).toEqual({
      chatId: 'chat-1',
      result: 'unavailable'
    })
    expect(ctx.loads).toBe(0)
    expect(ctx.world.reads).toEqual([])
  })

  it('starts the timer over when the mode changes, and only then', async () => {
    const ctx = harness({})
    ctx.service.start(ctx.store.getSettings, { store: () => ctx.store })
    ctx.service.start(ctx.store.getSettings, { store: () => ctx.store })
    expect(ctx.timers).toHaveLength(1)
    ctx.set({ forkIdleSweepIdleSeconds: 60 })
    expect(ctx.timers).toHaveLength(1)
    ctx.set({ forkIdleSweepMode: 'inbox' })
    expect(ctx.timers.map((timer) => timer.stopped)).toEqual([true, false])
    expect(ctx.changes).toBe(1)
    expect(await ctx.timers[1].options.run()).toBe(true)
    expect(await ctx.service.readStatus()).toMatchObject({ mode: 'inbox', running: true })
  })

  it('keeps a paused chat in the inbox as it was, marked, and out of the counts', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = waiting
    await ctx.service.sweep()
    await ctx.service.setPaused({ chatId: 'chat-1', paused: true })
    expect((await ctx.service.listInbox()).items).toMatchObject([
      { chatId: 'chat-1', question: 'Which one?', paused: true }
    ])
    expect(await ctx.service.readStatus()).toMatchObject({ waiting: 0, paused: ['chat-1'] })
    await ctx.service.setPaused({ chatId: 'chat-1', paused: false })
    expect(await ctx.service.readStatus()).toMatchObject({ waiting: 1, paused: [] })
  })

  it('sweeps, saves, notifies new waits once and tells its listeners', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = waiting
    ctx.service.start(ctx.store.getSettings, { store: () => ctx.store })
    expect(await ctx.service.sweep()).toBe(true)
    expect(ctx.notified).toEqual([['chat-1']])
    expect(ctx.changes).toBe(1)
    expect(ctx.saves).toBe(1)
    expect(ctx.file.chats['chat-1'].verdict).toBe('waiting_user')
    expect((await ctx.service.listInbox()).items).toMatchObject([
      { chatId: 'chat-1', question: 'Which one?', paused: false }
    ])
    expect(await ctx.service.readStatus()).toMatchObject({
      waiting: 1,
      stalled: 0,
      lastSweepAt: 50_000,
      classifier: 'builtin'
    })

    ctx.now = 65_000
    await ctx.service.sweep()
    expect(ctx.notified).toHaveLength(1)
    expect(ctx.changes).toBe(1)
    expect(ctx.saves).toBe(1)
    expect(ctx.loads).toBe(1)
  })

  it('runs one sweep at a time', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const classify = ctx.world.deps.classify
    ctx.world.deps.classify = async (...args) => {
      await gate
      return classify(...args)
    }
    const first = ctx.service.sweep()
    expect(await ctx.service.sweep()).toBe(true)
    release()
    await first
    expect(ctx.world.classified).toEqual(['chat-1'])
  })

  it('sends an answer as a turn and clears the item', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate({ kind: 'terminal' })]
    ctx.world.verdict = waiting
    await ctx.service.sweep()
    expect(await ctx.service.answer({ chatId: 'nobody', text: 'x' })).toMatchObject({
      result: 'not-found'
    })
    expect(await ctx.service.answer({ chatId: 'chat-1', text: 'the second' })).toEqual({
      chatId: 'chat-1',
      result: 'sent'
    })
    expect(ctx.answers).toEqual([{ chatId: 'chat-1', text: 'the second' }])
    expect((await ctx.service.listInbox()).items).toEqual([])
    expect(ctx.file.chats['chat-1']).toMatchObject({ verdict: 'finished', wakes: 0 })
    expect(ctx.changes).toBe(2)
    expect(await ctx.service.answer({ chatId: 'chat-1', text: 'again' })).toMatchObject({
      result: 'not-waiting'
    })
    expect(ctx.answers).toHaveLength(1)
  })

  it('keeps the item when the answer could not be sent', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = waiting
    await ctx.service.sweep()
    ctx.answerOutcome = 'unavailable'
    expect(await ctx.service.answer({ chatId: 'chat-1', text: 'x' })).toMatchObject({
      result: 'unavailable'
    })
    expect((await ctx.service.listInbox()).items).toHaveLength(1)
  })

  it('saves a pause through the settings store and shows it in the inbox at once', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = waiting
    ctx.service.start(ctx.store.getSettings, { store: () => ctx.store })
    await ctx.service.sweep()
    expect(await ctx.service.setPaused({ chatId: 'chat-1', paused: true })).toEqual({
      chatId: 'chat-1',
      paused: true,
      pausedCount: 1,
      saved: true
    })
    expect(ctx.store.getSettings().forkIdleSweepPaused).toEqual(['chat-1'])
    expect((await ctx.service.listInbox()).items).toMatchObject([{ paused: true }])
    expect(await ctx.service.setPaused({ chatId: 'chat-1', paused: false })).toMatchObject({
      paused: false,
      pausedCount: 0,
      saved: true
    })
  })

  it('says a pause was not saved when it has no settings store', async () => {
    const ctx = harness()
    ctx.service.start(ctx.store.getSettings)
    expect(await ctx.service.setPaused({ chatId: 'chat-1', paused: true })).toEqual({
      chatId: 'chat-1',
      paused: false,
      pausedCount: 0,
      saved: false
    })
  })

  it('keeps the wake cap across a restart of the service', async () => {
    const ctx = harness({ forkIdleSweepMode: 'wake', forkIdleSweepMaxWakes: 1 })
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = testVerdict({ verdict: 'stalled', nextStep: 'go on' })
    await ctx.service.sweep()
    expect(ctx.world.wakes).toHaveLength(1)

    const restarted = harness({ forkIdleSweepMode: 'wake', forkIdleSweepMaxWakes: 1 })
    restarted.file = ctx.file
    restarted.now = 150_000
    restarted.world.verdict = ctx.world.verdict
    restarted.world.candidates = [testCandidate({ idleSince: 100_000, requestSource: 'wake' })]
    restarted.world.endings.set('chat-1', { lastUserRequest: 'wake', lastAssistantMessage: 'x' })
    await restarted.service.sweep()
    expect(restarted.world.wakes).toEqual([])
    expect(await restarted.service.readStatus()).toMatchObject({ stalled: 1 })
  })

  it('survives a failing notifier and a failing save', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const world = fakeSweepWorld()
    world.candidates = [testCandidate()]
    world.verdict = waiting
    const service = createIdleRecoveryService({
      now: () => 50_000,
      loadState: async () => emptyIdleRecoveryState(),
      saveState: async () => {
        throw new Error('disk full')
      },
      sweep: (input) => runIdleRecoverySweep({ ...input, deps: world.deps }),
      notify: async () => {
        throw new Error('no route')
      },
      startTimer: () => () => {},
      useRuntime: () => {}
    })
    service.start(() => ({ forkIdleSweepMode: 'inbox' }))
    await expect(service.sweep()).resolves.toBe(true)
    expect((await service.listInbox()).items).toHaveLength(1)
    warn.mockRestore()
  })

  it('shows another source rows with the mode off and routes answer and Stop to it (SLRM-2386)', async () => {
    const ctx = harness({})
    const dismissed: string[] = []
    const answered: string[] = []
    const remove = registerForkInboxSource({
      id: 'babysit',
      items: async () => [
        {
          chatId: 'chat-9',
          kind: 'chat',
          agent: '',
          title: 'PR acme/api#12',
          workspace: '',
          worktreeId: null,
          verdict: 'stalled',
          question: '',
          reason: 'PR babysitter stopped',
          since: 1,
          wakes: 0,
          wakeAt: null,
          paused: false,
          source: 'babysit',
          prKey: 'github.com/acme/api#12'
        }
      ],
      answer: async (chatId, text) => {
        answered.push(`${chatId}:${text}`)
        return 'sent'
      },
      dismiss: async (chatId) => {
        dismissed.push(chatId)
        return true
      }
    })
    try {
      const inbox = await ctx.service.listInbox()
      expect(inbox.mode).toBe('off')
      expect(inbox.items.map((item) => item.source)).toEqual(['babysit'])
      expect(ctx.loads).toBe(0)
      expect(
        await ctx.service.answer({ chatId: 'chat-9', text: 'go on', source: 'babysit' })
      ).toEqual({ chatId: 'chat-9', result: 'sent' })
      expect(answered).toEqual(['chat-9:go on'])
      // Without the source the idle-recovery path answers, which is off here.
      expect(await ctx.service.answer({ chatId: 'chat-9', text: 'x' })).toMatchObject({
        result: 'unavailable'
      })
      expect(
        await ctx.service.setPaused({ chatId: 'chat-9', paused: true, source: 'babysit' })
      ).toMatchObject({ saved: true, paused: false })
      expect(dismissed).toEqual(['chat-9'])
    } finally {
      remove()
    }
    expect((await ctx.service.listInbox()).items).toEqual([])
  })
})
