// Agent guards (SLRM-2385): the engine's rules on fake ports, a fake clock and an in-memory record
// map. Nothing here reaches a chat host, a terminal or the disk.
import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_GUARD_LOOP_MESSAGE,
  readAgentGuardSettings,
  type AgentGuardToolCall
} from '../../../shared/fork/agent-guards'
import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentGuardActPorts } from './agent-guards-act'
import { AgentGuardEngine, type AgentGuardSpend } from './agent-guards-engine'
import type { AgentGuardAutomationSpend, AgentGuardRun } from './agent-guards-types'
import type { AgentGuardRecords } from './agent-guards-state'

function world(
  options: {
    settings?: Record<string, unknown>
    spend?: AgentGuardSpend
    spendOf?: (id: string) => AgentGuardSpend
    run?: (id: string) => AgentGuardRun | null
    automationLimits?: (id: string, automationId: string) => AgentGuardAutomationSpend[]
    refreshSpend?: (id: string) => Promise<void>
  } = {}
) {
  let now = 1000
  const inTurn = new Map<string, boolean>()
  const tails = new Map<string, AgentJournalRenderItem[]>()
  const ports: AgentGuardActPorts = {
    chatInTurn: vi.fn((id: string) => inTurn.get(id) ?? false),
    chatTail: vi.fn(async (id: string) => tails.get(id) ?? []),
    warnChat: vi.fn(async () => 'sent' as const),
    stopChat: vi.fn(async () => true),
    warnTerminal: vi.fn(async () => 'sent' as const),
    stopTerminal: vi.fn(async () => true)
  }
  const records: AgentGuardRecords = new Map()
  let spend: AgentGuardSpend = options.spend ?? { totalUsd: null, isWorker: false }
  const notify = vi.fn()
  const save = vi.fn(async () => {})
  const engine = new AgentGuardEngine({
    ports,
    records,
    save,
    now: () => now,
    settings: () => readAgentGuardSettings({ forkAgentGuardLoopRepeats: 3, ...options.settings }),
    spend: (id) => options.spendOf?.(id) ?? spend,
    ...(options.run ? { run: options.run } : {}),
    ...(options.automationLimits ? { automationLimits: options.automationLimits } : {}),
    ...(options.refreshSpend ? { refreshSpend: options.refreshSpend } : {}),
    notify,
    changed: () => {},
    startedAt: 500
  })
  return {
    engine,
    ports,
    records,
    notify,
    save,
    inTurn,
    tails,
    tick: (ms: number) => {
      now += ms
    },
    setSpend: (next: AgentGuardSpend) => {
      spend = next
    },
    now: () => now
  }
}

const chat = { kind: 'chat' as const, agent: 'claude', title: 'Worker', worktreeId: 'wt' }
const terminal = { kind: 'terminal' as const, agent: 'codex', title: 'Codex', worktreeId: 'wt' }

function fail(at: number): AgentGuardToolCall {
  return { tool: 'Bash', input: { command: 'npm test' }, failed: true, error: 'Exit code 1', at }
}

describe('AgentGuardEngine: the loop guard', () => {
  it('warns once, then pauses a chat that fails the same way again, and lists it', async () => {
    const w = world()
    w.inTurn.set('s1', true)
    for (let index = 0; index < 3; index += 1) {
      w.tick(10)
      await w.engine.observe('s1', chat, fail(w.now()))
    }
    expect(w.ports.warnChat).toHaveBeenCalledWith('s1', AGENT_GUARD_LOOP_MESSAGE)
    expect(w.engine.entries()[0]).toMatchObject({ id: 's1', state: 'warned', repeats: 3 })
    w.tick(10)
    await w.engine.observe('s1', chat, fail(w.now()))
    expect(w.ports.warnChat).toHaveBeenCalledTimes(1)
    expect(w.ports.stopChat).toHaveBeenCalledWith('s1')
    expect(w.engine.isPaused('s1')).toBe(true)
    expect(w.engine.heldIds()).toEqual(['s1'])
    expect(w.notify).toHaveBeenCalledTimes(1)
    expect(w.engine.entries()[0]).toMatchObject({ state: 'paused', reason: 'loop', repeats: 4 })
    // A paused agent's later calls are not watched.
    await w.engine.observe('s1', chat, fail(w.now() + 1))
    expect(w.ports.stopChat).toHaveBeenCalledTimes(1)
  })

  it('tries an undelivered warning again at the next failure', async () => {
    const w = world()
    vi.mocked(w.ports.warnTerminal).mockResolvedValueOnce('refused')
    for (let index = 0; index < 4; index += 1) {
      w.tick(10)
      await w.engine.observe('tab:1', terminal, fail(w.now()))
    }
    expect(w.ports.warnTerminal).toHaveBeenCalledTimes(2)
    expect(w.engine.isPaused('tab:1')).toBe(false)
  })

  it('marks a terminal agent it could not interrupt', async () => {
    const w = world()
    vi.mocked(w.ports.stopTerminal).mockResolvedValue(false)
    for (let index = 0; index < 4; index += 1) {
      w.tick(10)
      await w.engine.observe('tab:1', terminal, fail(w.now()))
    }
    expect(w.engine.entries()[0]).toMatchObject({ state: 'paused', notInterrupted: true })
  })

  it('does nothing with the loop guard off', async () => {
    const w = world({ settings: { forkAgentGuardLoop: false } })
    for (let index = 0; index < 6; index += 1) {
      await w.engine.observe('s1', chat, fail(2000 + index))
    }
    expect(w.ports.warnChat).not.toHaveBeenCalled()
  })

  it('reads a working chat from its journal and never replays rows from before it started', async () => {
    const w = world()
    w.inTurn.set('s1', true)
    const item = (id: string, at: number): AgentJournalRenderItem =>
      ({
        itemId: id,
        revision: 1,
        sequence: at,
        observedAt: at,
        body: {
          kind: 'tool-call',
          name: 'Bash',
          input: { command: 'npm test' },
          state: 'failed',
          output: { head: 'Exit code 1', byteLength: 11, digest: 'x', truncated: false }
        }
      }) as AgentJournalRenderItem
    w.tails.set('s1', [item('old1', 100), item('old2', 200), item('a', 600), item('b', 700)])
    await w.engine.sweepChat({ ...chat, sessionId: 's1', working: true })
    expect(w.ports.warnChat).not.toHaveBeenCalled()
    w.tails.set('s1', [item('a', 600), item('b', 700), item('c', 800)])
    await w.engine.sweepChat({ ...chat, sessionId: 's1', working: true })
    expect(w.ports.warnChat).toHaveBeenCalledTimes(1)
  })
})

describe('AgentGuardEngine: the spend cap', () => {
  it('pauses a worker at the turn end that took it past the default cap, not mid-turn', async () => {
    const w = world({
      settings: { forkAgentGuardSpendCapUsd: 5 },
      spend: { totalUsd: 6, isWorker: true }
    })
    w.engine.noteMeta('s1', chat)
    w.inTurn.set('s1', true)
    await w.engine.onTurn('s1', 'end')
    expect(w.engine.isPaused('s1')).toBe(false)
    w.inTurn.set('s1', false)
    await w.engine.onTurn('s1', 'end')
    expect(w.engine.entries()[0]).toMatchObject({
      state: 'paused',
      reason: 'spend',
      spentUsd: 6,
      capUsd: 5
    })
    expect(w.ports.stopChat).not.toHaveBeenCalled()
  })

  it('leaves a chat the default scope does not cover', async () => {
    const w = world({
      settings: { forkAgentGuardSpendCapUsd: 5 },
      spend: { totalUsd: 60, isWorker: false }
    })
    await w.engine.onTurn('s1', 'end')
    expect(w.engine.isPaused('s1')).toBe(false)
  })

  it('a chat of its own cap counts from when it was set, and resume starts its count again', async () => {
    const w = world({ spend: { totalUsd: 10, isWorker: false } })
    w.engine.noteMeta('s1', chat)
    expect(await w.engine.setCap('s1', 2)).toEqual({ capUsd: 2, spentUsd: 0 })
    w.setSpend({ totalUsd: 11, isWorker: false })
    await w.engine.onTurn('s1', 'end')
    expect(w.engine.isPaused('s1')).toBe(false)
    expect(w.engine.entries()[0]).toMatchObject({ state: 'capped', spentUsd: 1, capUsd: 2 })
    w.setSpend({ totalUsd: 12.5, isWorker: false })
    await w.engine.onTurn('s1', 'end')
    expect(w.engine.isPaused('s1')).toBe(true)
    expect(await w.engine.resume('s1')).toBe('resumed')
    expect(w.records.get('s1')?.baselineUsd).toBe(12.5)
    expect(await w.engine.resume('s1')).toBe('not-paused')
    expect((await w.engine.setCap('s1', 0)).capUsd).toBeNull()
  })
})

describe('AgentGuardEngine: a paused chat', () => {
  function message(from: boolean): AgentJournalRenderItem {
    return {
      itemId: 'm',
      revision: 1,
      sequence: 5,
      observedAt: 5,
      body: {
        kind: 'message',
        role: 'user',
        blocks: [{ type: 'text', text: 'go' }],
        ...(from ? { from: { kind: 'agent', senders: [], orchestration: null } } : {})
      }
    } as AgentJournalRenderItem
  }

  async function paused() {
    const w = world({
      settings: { forkAgentGuardSpendCapUsd: 1, forkAgentGuardSpendCapScope: 'all' },
      spend: { totalUsd: 2, isWorker: false }
    })
    w.engine.noteMeta('s1', chat)
    await w.engine.onTurn('s1', 'end')
    expect(w.engine.isPaused('s1')).toBe(true)
    w.inTurn.set('s1', true)
    return w
  }

  it('stops a turn another agent started', async () => {
    const w = await paused()
    w.tails.set('s1', [message(true)])
    await w.engine.onTurn('s1', 'start')
    expect(w.ports.stopChat).toHaveBeenCalledWith('s1')
    expect(w.engine.isPaused('s1')).toBe(true)
  })

  it('a turn a person started lifts the pause', async () => {
    const w = await paused()
    w.tails.set('s1', [message(false)])
    await w.engine.sweepChat({ ...chat, sessionId: 's1', working: true })
    expect(w.ports.stopChat).not.toHaveBeenCalled()
    expect(w.engine.isPaused('s1')).toBe(false)
  })
})

// BAD-679: caps for every agent, per Run and per automation, with hardcoded spend per agent.
describe('AgentGuardEngine: spend caps for every agent', () => {
  const codexChat = { kind: 'chat' as const, agent: 'codex', title: 'Codex chat', worktreeId: 'wt' }

  it('pauses a Codex chat between turns when its capped spend is reached', async () => {
    const w = world({
      settings: { forkAgentGuardSpendCapUsd: 3, forkAgentGuardSpendCapScope: 'all' },
      spend: { totalUsd: 3.5, isWorker: false }
    })
    w.engine.noteMeta('codex-1', codexChat)
    w.inTurn.set('codex-1', true)
    await w.engine.onTurn('codex-1', 'end')
    // Not between turns yet: the turn is still open.
    expect(w.engine.isPaused('codex-1')).toBe(false)
    w.inTurn.set('codex-1', false)
    await w.engine.onTurn('codex-1', 'end')
    expect(w.engine.entries()[0]).toMatchObject({
      id: 'codex-1',
      agent: 'codex',
      state: 'paused',
      reason: 'spend',
      scope: 'chat',
      spentUsd: 3.5,
      capUsd: 3
    })
  })

  it('stops a terminal agent past its cap after reading its transcript', async () => {
    let total = 0
    const refreshSpend = vi.fn(async () => {
      total += 2
    })
    const w = world({
      settings: { forkAgentGuardSpendCapUsd: 3, forkAgentGuardSpendCapScope: 'all' },
      spendOf: () => ({ totalUsd: total, isWorker: false }),
      refreshSpend
    })
    await w.engine.observeTerminalSpend('tab:1', terminal)
    expect(w.ports.stopTerminal).not.toHaveBeenCalled()
    await w.engine.observeTerminalSpend('tab:1', terminal)
    expect(refreshSpend).toHaveBeenCalledTimes(2)
    expect(w.ports.stopTerminal).toHaveBeenCalledWith('tab:1', 'codex')
    expect(w.engine.entries()[0]).toMatchObject({
      id: 'tab:1',
      kind: 'terminal',
      state: 'paused',
      scope: 'chat',
      spentUsd: 4,
      capUsd: 3
    })
    // A paused terminal is not read or stopped again.
    await w.engine.observeTerminalSpend('tab:1', terminal)
    expect(w.ports.stopTerminal).toHaveBeenCalledTimes(1)
  })

  describe('a Run cap', () => {
    const spends: Record<string, number> = { coord: 4, w1: 5, w2: 3 }
    const run = (id: string): AgentGuardRun | null =>
      id in spends ? { rootId: 'coord', memberIds: ['coord', 'w1', 'w2'], totalUsd: 12 } : null
    const setup = () => {
      const w = world({
        settings: { forkAgentGuardRunCapUsd: 10 },
        spendOf: (id) => ({ totalUsd: spends[id] ?? null, isWorker: id !== 'coord' }),
        run
      })
      for (const id of Object.keys(spends)) {
        w.engine.noteMeta(id, { ...chat, title: id })
      }
      return w
    }

    it('sums the coordinator and its workers and pauses all of them', async () => {
      const w = setup()
      w.inTurn.set('w2', true)
      await w.engine.onTurn('w1', 'end')
      expect(w.engine.isPaused('w1')).toBe(true)
      expect(w.engine.isPaused('coord')).toBe(true)
      expect(w.records.get('coord')?.paused).toMatchObject({
        scope: 'run',
        spentUsd: 12,
        capUsd: 10
      })
      // A worker still in its turn is paused when the turn ends.
      expect(w.engine.isPaused('w2')).toBe(false)
      w.inTurn.set('w2', false)
      await w.engine.onTurn('w2', 'end')
      expect(w.engine.isPaused('w2')).toBe(true)
    })

    it('lists the Run cap with each agent and counts from a resume', async () => {
      const w = setup()
      await w.engine.onTurn('coord', 'end')
      expect(await w.engine.resume('w1')).toBe('resumed')
      expect(w.records.get('coord')?.limitBaselines).toEqual({ run: 12 })
      expect(w.engine.caps.runSpentOf('coord', 12)).toBe(0)
      expect(w.engine.caps.runSpentOf('coord', 15)).toBe(3)
      expect(w.engine.entries().find((entry) => entry.id === 'w1')).toMatchObject({
        state: 'capped',
        scope: 'run',
        limits: [{ scope: 'run', capUsd: 10, spentUsd: 0 }]
      })
    })

    it('gives one Run its own cap over the default', async () => {
      const w = setup()
      expect(await w.engine.caps.setRunCap('w1', 50)).toMatchObject({
        capUsd: 50,
        rootId: 'coord'
      })
      expect(w.engine.caps.runCapOf('coord')).toBe(50)
      await w.engine.onTurn('w1', 'end')
      expect(w.engine.isPaused('w1')).toBe(false)
      expect((await w.engine.caps.setRunCap('w1', 0)).capUsd).toBeNull()
      expect(w.engine.caps.runCapOf('coord')).toBe(10)
    })
  })

  it('pauses an automation run past its per-day cap and lists the cap per scope', async () => {
    let daySpent = 7
    const w = world({
      spend: { totalUsd: 1, isWorker: false },
      automationLimits: () => [
        { scope: 'automation-run', capUsd: 5, spentUsd: 1 },
        { scope: 'automation-day', capUsd: 8, spentUsd: daySpent }
      ]
    })
    w.engine.noteMeta('auto-chat', chat)
    await w.engine.noteAutomation('auto-chat', 'chat', 'automation-1')
    await w.engine.onTurn('auto-chat', 'end')
    expect(w.engine.entries()[0]).toMatchObject({
      state: 'capped',
      scope: 'automation-day',
      limits: [
        { scope: 'automation-run', capUsd: 5, spentUsd: 1 },
        { scope: 'automation-day', capUsd: 8, spentUsd: 7 }
      ]
    })
    daySpent = 9
    await w.engine.onTurn('auto-chat', 'end')
    expect(w.records.get('auto-chat')?.paused).toMatchObject({
      reason: 'spend',
      scope: 'automation-day',
      spentUsd: 9,
      capUsd: 8
    })
    // A resume counts the day's cap from what was spent by then.
    await w.engine.resume('auto-chat')
    expect(w.records.get('auto-chat')?.limitBaselines).toEqual({ 'automation-day': 9 })
    await w.engine.onTurn('auto-chat', 'end')
    expect(w.engine.isPaused('auto-chat')).toBe(false)
  })

  it('keeps the guards on for an agent that has an automation, with every default off', async () => {
    const w = world()
    expect(w.engine.hasOwnCaps()).toBe(false)
    await w.engine.noteAutomation('auto-chat', 'chat', 'automation-1')
    expect(w.engine.hasOwnCaps()).toBe(true)
  })
})
