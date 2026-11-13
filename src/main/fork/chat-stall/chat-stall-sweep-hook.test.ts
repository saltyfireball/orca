// The thin hook chat stall puts in the stock idle sweep: what it reports and what a release does.
import { describe, expect, it, vi } from 'vitest'
import {
  StructuredAgentSessionIdleSweep,
  type StructuredAgentSessionIdleSweepDeps
} from '../../native-chat/agent-session-wire/termination/structured-agent-session-idle-sweep'

function rig(options: { owed: boolean; child: boolean; decision: 'hold' | 'release' }) {
  const session = {
    child: options.child ? { phase: 'running' } : null,
    journal: { cursor: () => ({ epoch: 2, sequence: 7 }) }
  }
  const sessions = Object.assign(new Map([['s1', session]]), {
    lastActivityAt: () => 0,
    touch: vi.fn()
  })
  const stall = vi.fn(async () => options.decision)
  const attachStall = vi.fn()
  const stopAgent = vi.fn(async () => {})
  const closeConversation = vi.fn(async () => true)
  const deps = {
    sessions,
    serialize: (_id: string, task: () => Promise<unknown>) => task(),
    now: () => 0,
    isDisposed: () => false,
    deliveryActive: () => options.owed,
    childWorkOpen: () => false,
    hasOpenDispatch: () => false,
    providerHoldsDispatch: () => false,
    confirmIdle: () => undefined,
    store: {
      getConversation: () => ({ ownerObservation: { ownerProcess: { pid: 4242 } } }),
      replacedRuntime: () => undefined
    },
    stopAgent,
    stopStartingAgent: vi.fn(async () => {}),
    closeConversation,
    logger: { warn: vi.fn() },
    intervalMs: 3_600_000,
    stall,
    attachStall
  } as unknown as StructuredAgentSessionIdleSweepDeps
  return {
    sweep: new StructuredAgentSessionIdleSweep(deps),
    sessions,
    stall,
    attachStall,
    stopAgent,
    closeConversation
  }
}

describe('idle sweep chat stall hook', () => {
  it('reports a chat held busy with its journal cursor and owner pid, and keeps holding it', async () => {
    const r = rig({ owed: true, child: true, decision: 'hold' })
    await r.sweep.tick()
    expect(r.stall).toHaveBeenCalledWith('s1', { progress: '2:7', ownerPid: 4242 })
    expect(r.sessions.touch).toHaveBeenCalledWith('s1')
    expect(r.stopAgent).not.toHaveBeenCalled()
  })

  it('retires the chat the stock way on release', async () => {
    const r = rig({ owed: true, child: true, decision: 'release' })
    await r.sweep.tick()
    expect(r.stopAgent).toHaveBeenCalledWith('s1')
    expect(r.closeConversation).toHaveBeenCalledWith('s1')
    expect(r.sessions.touch).not.toHaveBeenCalled()
  })

  it('tells the monitor a chat is not held busy', async () => {
    const r = rig({ owed: false, child: false, decision: 'release' })
    await r.sweep.tick()
    expect(r.stall).toHaveBeenCalledWith('s1', null)
    expect(r.stopAgent).not.toHaveBeenCalled()
  })

  it('hands the monitor its tick on start', () => {
    const r = rig({ owed: false, child: false, decision: 'hold' })
    r.sweep.start()
    r.sweep.dispose()
    expect(r.attachStall).toHaveBeenCalledTimes(1)
  })
})
