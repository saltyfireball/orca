// Sleepers (FORK.md): the idle sweep's sweepNow skips the idle window and keep-awake, but still
// refuses owed work, a starting provider and a send waiting to be delivered.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  StructuredAgentSessionIdleSweep,
  type StructuredAgentSessionIdleSweepDeps
} from '../../native-chat/agent-session-wire/termination/structured-agent-session-idle-sweep'
import type { StructuredAgentSessionHostSession } from '../../native-chat/agent-session-wire/host/structured-agent-session-host-types'
import { forkSleepersSweep, resetForkSleepersSweep } from './sleepers-sweep-registry'
import { forkChatSleepIdleSweep } from '../chat-sleep/chat-sleep-sweep'

afterEach(() => resetForkSleepersSweep())

type Opts = {
  child?: { phase: string }
  queued?: boolean
  delivering?: boolean
  disposed?: boolean
  keepAwake?: (id: string) => boolean
  attach?: StructuredAgentSessionIdleSweepDeps['attach']
}

function rig(opts: Opts = {}) {
  const now = 1_000_000
  const submissions = opts.queued
    ? [{ handoverRecorded: true, dispatchState: 'pending', handedOverAt: undefined }]
    : []
  const session = {
    child: opts.child,
    journal: { inputOrder: { recoverableSubmissions: () => submissions } }
  } as unknown as StructuredAgentSessionHostSession
  const sessions = Object.assign(new Map([['s1', session]]), {
    // Active this very moment: a timed tick would never close it.
    lastActivityAt: () => now,
    touch: vi.fn()
  })
  const deps = {
    sessions,
    serialize: <T>(_id: string, task: () => Promise<T>) => task(),
    now: () => now,
    isDisposed: () => opts.disposed === true,
    deliveryActive: () => opts.delivering === true,
    childWorkOpen: () => false,
    hasOpenDispatch: () => false,
    providerHoldsDispatch: () => false,
    confirmIdle: () => undefined,
    store: {} as StructuredAgentSessionIdleSweepDeps['store'],
    stopAgent: vi.fn(async () => {}),
    stopStartingAgent: vi.fn(async () => {}),
    closeConversation: vi.fn(async () => true),
    logger: { warn: vi.fn() } as unknown as StructuredAgentSessionIdleSweepDeps['logger'],
    idleMs: () => 60 * 60_000,
    keepAwake: opts.keepAwake,
    attach: opts.attach
  } satisfies StructuredAgentSessionIdleSweepDeps
  return { sweep: new StructuredAgentSessionIdleSweep(deps), deps }
}

describe('StructuredAgentSessionIdleSweep.sweepNow', () => {
  it('closes a just-active, kept-awake conversation that a tick would leave', async () => {
    const r = rig({ keepAwake: () => true })
    await r.sweep.tick()
    expect(r.deps.closeConversation).not.toHaveBeenCalled()
    await r.sweep.sweepNow('s1')
    expect(r.deps.closeConversation).toHaveBeenCalledWith('s1')
  })

  it('refuses a send that is queued or being delivered', async () => {
    for (const opts of [{ queued: true }, { delivering: true }]) {
      const r = rig(opts)
      await r.sweep.sweepNow('s1')
      expect(r.deps.closeConversation).not.toHaveBeenCalled()
    }
  })

  it('never stops a provider that is still starting', async () => {
    const r = rig({ child: { phase: 'starting' } })
    await r.sweep.sweepNow('s1')
    expect(r.deps.stopStartingAgent).not.toHaveBeenCalled()
    expect(r.deps.closeConversation).not.toHaveBeenCalled()
  })

  it('renews instead of stopping a running provider that owes work', async () => {
    const r = rig({ child: { phase: 'running' }, delivering: true })
    await r.sweep.sweepNow('s1')
    expect(r.deps.stopAgent).not.toHaveBeenCalled()
    expect(r.deps.sessions.touch).toHaveBeenCalledWith('s1')
  })

  it('does nothing once disposed or for an unknown chat', async () => {
    const r = rig({ disposed: true })
    await r.sweep.sweepNow('s1')
    await rig().sweep.sweepNow('other')
    expect(r.deps.closeConversation).not.toHaveBeenCalled()
  })

  it('hands itself to the sleepers registry through the fork deps', () => {
    const fork = forkChatSleepIdleSweep(
      () => ({}),
      () => null
    )
    const r = rig({ attach: fork.attach })
    expect(forkSleepersSweep()).toBe(r.sweep)
  })
})
