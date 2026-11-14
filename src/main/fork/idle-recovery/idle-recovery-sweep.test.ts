import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildIdleRecoveryWakeMessage } from '../../../shared/fork/idle-recovery'
import type { IdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import {
  emptyIdleRecoveryState,
  listIdleRecoveryInboxItems,
  loadIdleRecoveryState,
  saveIdleRecoveryState,
  type IdleRecoveryStoredState
} from './idle-recovery-state'
import {
  IDLE_RECOVERY_DEFAULT_NEXT_STEP,
  IDLE_RECOVERY_FORGET_AFTER_MS,
  runIdleRecoverySweep
} from './idle-recovery-sweep'
import {
  fakeSweepWorld,
  testCandidate,
  testSettings,
  testVerdict
} from './idle-recovery-sweep-fixtures'

const stalled = testVerdict({ verdict: 'stalled', nextStep: 'run the tests' })
const waiting = testVerdict({ verdict: 'waiting_user', question: 'Which one?' })

function harness(settings: IdleRecoverySettings = testSettings()) {
  const world = fakeSweepWorld()
  const ctx = {
    world,
    settings,
    state: emptyIdleRecoveryState() as IdleRecoveryStoredState,
    sweep: (nowMs: number) =>
      runIdleRecoverySweep({ settings: ctx.settings, nowMs, state: ctx.state, deps: world.deps }),
    inbox: () => listIdleRecoveryInboxItems(ctx.state)
  }
  return ctx
}

/** The woken turn ended: the chat is idle again and its prompt was the wake. */
function afterWake(ctx: ReturnType<typeof harness>, round: number): void {
  ctx.world.candidates = [
    testCandidate({
      idleSince: 1_000 + round * 100_000,
      requestSource: 'wake',
      lastPrompt: buildIdleRecoveryWakeMessage('run the tests')
    })
  ]
  ctx.world.endings.set('chat-1', {
    lastUserRequest: buildIdleRecoveryWakeMessage('run the tests'),
    lastAssistantMessage: `ending ${round}`
  })
}

describe('runIdleRecoverySweep', () => {
  it('does nothing in mode off', async () => {
    const ctx = harness(testSettings({ forkIdleSweepMode: 'off' }))
    ctx.world.candidates = [testCandidate()]
    expect(await ctx.sweep(50_000)).toEqual({ changed: false, newlyWaiting: [] })
    expect(ctx.world.reads).toEqual([])
    expect(ctx.state.chats).toEqual({})
  })

  it('records a finished ending without listing it, and never reads it twice', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    expect((await ctx.sweep(50_000)).changed).toBe(false)
    await ctx.sweep(65_000)
    expect(ctx.state.chats['chat-1'].verdict).toBe('finished')
    expect(ctx.inbox()).toEqual([])
    expect(ctx.world.reads).toEqual(['chat-1'])
    expect(ctx.world.classified).toEqual(['chat-1'])
  })

  it('lists a waiting chat with its question and reports it as new once', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = waiting
    const first = await ctx.sweep(50_000)
    expect(first.changed).toBe(true)
    expect(first.newlyWaiting.map((item) => item.question)).toEqual(['Which one?'])
    expect(ctx.inbox()).toMatchObject([
      { chatId: 'chat-1', verdict: 'waiting_user', question: 'Which one?', since: 50_000 }
    ])
    expect(await ctx.sweep(65_000)).toEqual({ changed: false, newlyWaiting: [] })
    expect(ctx.world.wakes).toEqual([])
  })

  it('does not classify the same ending again when only the idle time moved', async () => {
    const ctx = harness()
    ctx.world.verdict = waiting
    ctx.world.candidates = [testCandidate()]
    await ctx.sweep(50_000)
    ctx.world.candidates = [testCandidate({ idleSince: 2_000 })]
    const second = await ctx.sweep(65_000)
    expect(ctx.world.reads).toEqual(['chat-1', 'chat-1'])
    expect(ctx.world.classified).toEqual(['chat-1'])
    expect(second.newlyWaiting).toEqual([])
  })

  it('never classifies an ending it cannot read', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.endings.set('chat-1', null)
    await ctx.sweep(50_000)
    expect(ctx.world.classified).toEqual([])
    expect(ctx.state.chats).toEqual({})
  })

  it('wakes a stalled chat in mode wake with the next step, and takes it off the inbox', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = stalled
    await ctx.sweep(50_000)
    expect(ctx.world.wakes).toEqual([{ chatId: 'chat-1', nextStep: 'run the tests' }])
    expect(ctx.state.chats['chat-1'].wakes).toBe(1)
    expect(ctx.inbox()).toEqual([])
    // Still idle with the same ending (the turn has not started yet): no second wake.
    await ctx.sweep(65_000)
    expect(ctx.world.wakes).toHaveLength(1)
    expect(ctx.world.classified).toEqual(['chat-1'])
  })

  it('sends a default next step when the classifier named none', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = testVerdict({ verdict: 'stalled' })
    await ctx.sweep(50_000)
    expect(ctx.world.wakes[0].nextStep).toBe(IDLE_RECOVERY_DEFAULT_NEXT_STEP)
  })

  it('never wakes in mode inbox: the stalled chat is listed', async () => {
    const ctx = harness(testSettings({ forkIdleSweepMode: 'inbox' }))
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = stalled
    expect((await ctx.sweep(50_000)).newlyWaiting).toEqual([])
    await ctx.sweep(65_000)
    expect(ctx.world.wakes).toEqual([])
    expect(ctx.inbox()).toMatchObject([{ verdict: 'stalled', wakeAt: null }])
  })

  it('waits wake_after_seconds, capped by the recheck ceiling, before the wake', async () => {
    const ctx = harness(testSettings({ forkIdleSweepRecheckMaxMinutes: 2 }))
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = testVerdict({ ...stalled, wakeAfterSeconds: 9_999 })
    await ctx.sweep(50_000)
    expect(ctx.inbox()).toMatchObject([{ verdict: 'stalled', wakeAt: 170_000 }])
    await ctx.sweep(169_000)
    expect(ctx.world.wakes).toEqual([])
    await ctx.sweep(170_000)
    expect(ctx.world.wakes).toHaveLength(1)
    expect(ctx.world.classified).toEqual(['chat-1'])
  })

  it('looks again at a finished ending when the classifier asked for a later look', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = testVerdict({ wakeAfterSeconds: 60 })
    await ctx.sweep(50_000)
    await ctx.sweep(100_000)
    expect(ctx.world.classified).toHaveLength(1)
    ctx.world.verdict = waiting
    const result = await ctx.sweep(110_000)
    expect(ctx.world.classified).toHaveLength(2)
    expect(result.newlyWaiting).toHaveLength(1)
  })

  it('stops at the wake cap and then lists the chat as stalled', async () => {
    const ctx = harness(testSettings({ forkIdleSweepMaxWakes: 2 }))
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = stalled
    await ctx.sweep(50_000)
    afterWake(ctx, 1)
    await ctx.sweep(150_000)
    expect(ctx.world.wakes).toHaveLength(2)
    afterWake(ctx, 2)
    await ctx.sweep(250_000)
    expect(ctx.world.wakes).toHaveLength(2)
    expect(ctx.inbox()).toMatchObject([{ verdict: 'stalled', wakes: 2, wakeAt: null }])
  })

  it('gives the chat its wakes back after a turn the user started', async () => {
    const ctx = harness(testSettings({ forkIdleSweepMaxWakes: 1 }))
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = stalled
    await ctx.sweep(50_000)
    expect(ctx.state.chats['chat-1'].wakes).toBe(1)
    ctx.world.candidates = [testCandidate({ idleSince: 200_000, lastPrompt: 'something new' })]
    ctx.world.endings.set('chat-1', { lastUserRequest: 'something new', lastAssistantMessage: 'x' })
    await ctx.sweep(250_000)
    expect(ctx.world.wakes).toHaveLength(2)
    expect(ctx.state.chats['chat-1'].wakes).toBe(1)
  })

  it('keeps a stalled chat listed and asks again later when the wake was not taken', async () => {
    const ctx = harness(testSettings({ forkIdleSweepIdleSeconds: 30 }))
    ctx.world.candidates = [testCandidate({ kind: 'terminal' })]
    ctx.world.verdict = stalled
    ctx.world.wakeTaken = false
    await ctx.sweep(50_000)
    expect(ctx.inbox()).toMatchObject([{ verdict: 'stalled', wakes: 0, wakeAt: 80_000 }])
    await ctx.sweep(65_000)
    expect(ctx.world.wakes).toHaveLength(1)
    ctx.world.wakeTaken = true
    await ctx.sweep(80_000)
    expect(ctx.world.wakes).toHaveLength(2)
    expect(ctx.world.classified).toHaveLength(1)
    expect(ctx.inbox()).toEqual([])
  })

  it('holds a wake while background work is pending and sends it once that is over', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate({ backgroundPending: true })]
    ctx.world.verdict = stalled
    await ctx.sweep(50_000)
    expect(ctx.world.wakes).toEqual([])
    expect(ctx.inbox()).toMatchObject([{ verdict: 'stalled' }])
    ctx.world.candidates = [testCandidate()]
    await ctx.sweep(65_000)
    expect(ctx.world.wakes).toHaveLength(1)
    expect(ctx.world.classified).toHaveLength(1)
  })

  it('does not wake a turn that orchestration asked for', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate({ requestSource: 'orchestration' })]
    ctx.world.verdict = stalled
    await ctx.sweep(50_000)
    expect(ctx.world.wakes).toEqual([])
    expect(ctx.inbox()).toMatchObject([{ verdict: 'stalled', wakeAt: null }])
  })

  it('leaves a paused chat alone', async () => {
    const ctx = harness(testSettings({ forkIdleSweepPaused: ['chat-1'] }))
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = stalled
    await ctx.sweep(50_000)
    expect(ctx.world.reads).toEqual([])
    expect(ctx.world.wakes).toEqual([])
  })

  it('keeps the item of a chat paused after it was listed, marked paused', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = waiting
    await ctx.sweep(50_000)
    // The candidate list leaves a paused chat out.
    ctx.settings = testSettings({ forkIdleSweepPaused: ['chat-1'] })
    ctx.world.candidates = []
    await ctx.sweep(65_000)
    expect(ctx.inbox()).toMatchObject([{ chatId: 'chat-1', paused: true }])
    ctx.settings = testSettings()
    await ctx.sweep(80_000)
    expect(ctx.inbox()).toEqual([])
  })

  it('takes a chat off the inbox while it is not idle, and forgets it after a week', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = waiting
    await ctx.sweep(50_000)
    ctx.world.candidates = []
    expect((await ctx.sweep(65_000)).changed).toBe(true)
    expect(ctx.inbox()).toEqual([])
    expect(ctx.state.chats['chat-1']).toBeDefined()
    await ctx.sweep(50_000 + IDLE_RECOVERY_FORGET_AFTER_MS + 1)
    expect(ctx.state.chats).toEqual({})
  })

  it('classifies with bounded concurrency', async () => {
    const ctx = harness()
    ctx.world.candidates = Array.from({ length: 8 }, (_, index) =>
      testCandidate({ chatId: `chat-${index}` })
    )
    ctx.world.deps.concurrency = 2
    await ctx.sweep(50_000)
    expect(ctx.world.classified).toHaveLength(8)
    expect(ctx.world.peak).toBe(2)
  })

  it('survives a classifier that throws: the ending is looked at again next sweep', async () => {
    const ctx = harness()
    ctx.world.candidates = [testCandidate()]
    ctx.world.deps.classify = async () => {
      throw new Error('boom')
    }
    await expect(ctx.sweep(50_000)).resolves.toEqual({ changed: false, newlyWaiting: [] })
    expect(ctx.state.chats).toEqual({})
  })
})

describe('the wake cap across a restart', () => {
  let dir: string | null = null
  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true })
      dir = null
    }
  })

  it('holds when the state is saved, the app restarts and the sweep runs again', async () => {
    dir = await mkdtemp(join(tmpdir(), 'idle-recovery-'))
    const path = join(dir, 'state.json')
    const ctx = harness(testSettings({ forkIdleSweepMaxWakes: 1 }))
    ctx.world.candidates = [testCandidate()]
    ctx.world.verdict = stalled
    await ctx.sweep(50_000)
    expect(ctx.world.wakes).toHaveLength(1)
    await saveIdleRecoveryState(ctx.state, path)

    // A new process: nothing in memory, only the file.
    const restarted = harness(ctx.settings)
    restarted.state = await loadIdleRecoveryState(path)
    restarted.world.verdict = stalled
    afterWake(restarted, 1)
    await restarted.sweep(150_000)
    expect(restarted.world.wakes).toEqual([])
    expect(restarted.inbox()).toMatchObject([{ verdict: 'stalled', wakes: 1, wakeAt: null }])
  })
})
