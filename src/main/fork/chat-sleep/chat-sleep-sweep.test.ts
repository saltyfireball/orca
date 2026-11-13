import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  forkChatSleepIdleSweep,
  isForkChatOnScreen,
  resetForkChatSleepOnScreen,
  setForkChatSleepOnScreen,
  clearForkChatSleepOnScreen
} from './chat-sleep-sweep'
import {
  StructuredAgentSessionIdleSweep,
  type StructuredAgentSessionIdleSweepDeps
} from '../../native-chat/agent-session-wire/termination/structured-agent-session-idle-sweep'
import type { StructuredAgentSessionHostSession } from '../../native-chat/agent-session-wire/host/structured-agent-session-host-types'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'

afterEach(() => resetForkChatSleepOnScreen())

describe('on-screen registry', () => {
  it('keeps each window list apart and drops a closed window only', () => {
    setForkChatSleepOnScreen(1, ['a', 'b'])
    setForkChatSleepOnScreen(2, ['c'])
    expect(isForkChatOnScreen('a')).toBe(true)
    expect(isForkChatOnScreen('c')).toBe(true)
    clearForkChatSleepOnScreen(2)
    expect(isForkChatOnScreen('c')).toBe(false)
    expect(isForkChatOnScreen('b')).toBe(true)
  })

  it('replaces a window list and reads bad input as empty', () => {
    setForkChatSleepOnScreen(1, ['a'])
    setForkChatSleepOnScreen(1, ['b'])
    expect(isForkChatOnScreen('a')).toBe(false)
    setForkChatSleepOnScreen(1, 'not a list')
    expect(isForkChatOnScreen('b')).toBe(false)
  })
})

describe('forkChatSleepIdleSweep', () => {
  const stock = vi.fn(() => 45 * 60_000)

  it('uses the stock window and keeps nothing awake while off', () => {
    setForkChatSleepOnScreen(1, ['s1'])
    const sweep = forkChatSleepIdleSweep(() => ({}), stock)
    expect(sweep.idleMs()).toBe(45 * 60_000)
    expect(sweep.keepAwake('s1')).toBe(false)
  })

  it('uses its own window and keeps on-screen chats awake while on', () => {
    setForkChatSleepOnScreen(1, ['s1'])
    const sweep = forkChatSleepIdleSweep(
      () => ({ forkChatSleep: true, forkChatSleepIdleMinutes: 10 }),
      stock
    )
    expect(sweep.idleMs()).toBe(10 * 60_000)
    expect(sweep.keepAwake('s1')).toBe(true)
    expect(sweep.keepAwake('s2')).toBe(false)
  })

  it('defaults to 30 minutes and lets on-screen chats sleep when that is switched off', () => {
    setForkChatSleepOnScreen(1, ['s1'])
    const sweep = forkChatSleepIdleSweep(
      () => ({ forkChatSleep: true, forkChatSleepKeepVisible: false }),
      stock
    )
    expect(sweep.idleMs()).toBe(30 * 60_000)
    expect(sweep.keepAwake('s1')).toBe(false)
  })

  it('keeps a pinned chat awake whether chat sleep is on or off', () => {
    const off = forkChatSleepIdleSweep(() => ({ forkSleepersPinned: ['p1'] }), stock)
    expect(off.keepAwake('p1')).toBe(true)
    expect(off.keepAwake('s1')).toBe(false)
    const on = forkChatSleepIdleSweep(
      () => ({ forkChatSleep: true, forkChatSleepKeepVisible: false, forkSleepersPinned: ['p1'] }),
      stock
    )
    expect(on.keepAwake('p1')).toBe(true)
    expect(on.keepAwake('s1')).toBe(false)
  })

  it('reads settings on every call and falls back to stock when the read throws', () => {
    let settings: ForkGlobalSettings = { forkChatSleep: true, forkChatSleepIdleMinutes: 5 }
    const sweep = forkChatSleepIdleSweep(() => settings, stock)
    expect(sweep.idleMs()).toBe(5 * 60_000)
    settings = { forkChatSleep: false }
    expect(sweep.idleMs()).toBe(45 * 60_000)
    const broken = forkChatSleepIdleSweep(() => {
      throw new Error('no store')
    }, stock)
    expect(broken.idleMs()).toBe(45 * 60_000)
    expect(broken.keepAwake('s1')).toBe(false)
  })
})

describe('the stock idle sweep with the keepAwake hook', () => {
  function rig(keepAwake: ((id: string) => boolean) | undefined) {
    let now = 1_000_000
    const activity = new Map<string, number>([['s1', now]])
    // A conversation held open with no provider child: the sweep closes it once idle.
    const session = { child: undefined } as unknown as StructuredAgentSessionHostSession
    const sessions = Object.assign(new Map([['s1', session]]), {
      lastActivityAt: (id: string) => activity.get(id),
      touch: vi.fn((id: string) => activity.set(id, now))
    })
    const closeConversation = vi.fn(async () => true)
    const deps = {
      sessions,
      serialize: <T>(_id: string, task: () => Promise<T>) => task(),
      now: () => now,
      isDisposed: () => false,
      deliveryActive: () => false,
      childWorkOpen: () => false,
      hasOpenDispatch: () => false,
      providerHoldsDispatch: () => false,
      confirmIdle: () => undefined,
      store: {} as StructuredAgentSessionIdleSweepDeps['store'],
      stopAgent: vi.fn(async () => {}),
      stopStartingAgent: vi.fn(async () => {}),
      closeConversation,
      logger: { warn: vi.fn() } as unknown as StructuredAgentSessionIdleSweepDeps['logger'],
      idleMs: () => 60_000,
      keepAwake
    } satisfies StructuredAgentSessionIdleSweepDeps
    const sweep = new StructuredAgentSessionIdleSweep(deps)
    return {
      sweep,
      sessions,
      closeConversation,
      advance: (ms: number) => {
        now += ms
      }
    }
  }

  it('closes an idle conversation without the hook', async () => {
    const r = rig(undefined)
    r.advance(61_000)
    await r.sweep.tick()
    expect(r.closeConversation).toHaveBeenCalledWith('s1')
  })

  it('keeps a kept-awake conversation and renews its clock', async () => {
    const r = rig((id) => id === 's1')
    r.advance(61_000)
    await r.sweep.tick()
    expect(r.closeConversation).not.toHaveBeenCalled()
    expect(r.sessions.touch).toHaveBeenCalledWith('s1')
  })

  it('lets it sleep a full window after it leaves the screen', async () => {
    let awake = true
    const r = rig(() => awake)
    r.advance(61_000)
    await r.sweep.tick()
    awake = false
    r.advance(30_000)
    await r.sweep.tick()
    expect(r.closeConversation).not.toHaveBeenCalled()
    r.advance(31_000)
    await r.sweep.tick()
    expect(r.closeConversation).toHaveBeenCalledWith('s1')
  })
})
