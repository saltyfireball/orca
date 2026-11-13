// Sleepers (SLRM-2136): stalled and queued rows built from chat stall and launch queue fixtures.
import { describe, expect, it } from 'vitest'
import type { ForkAgentQueueEntry } from './agent-queue'
import { FORK_AGENT_QUEUE_MEMORY_HOLD_REASON } from './agent-queue'
import type { ForkChatStallEntry } from './chat-stall'
import {
  buildSleeperRows,
  canSleepNow,
  filterSleepers,
  forkSleepersButtonShown,
  SLEEPER_STATES,
  sortSleepers,
  type SleeperSource
} from './sleepers'
import { sleeperLifecycleOverlay } from './sleepers-lifecycle'

const NOW = 50_000_000

function source(over: Partial<SleeperSource> & { id: string }): SleeperSource {
  return {
    kind: 'chat',
    paneKey: `pane-${over.id}`,
    worktreeId: 'w1',
    workspace: 'alpha',
    title: over.id,
    agent: 'claude',
    model: null,
    status: 'working',
    stateStartedAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    processAlive: true,
    local: true,
    ...over
  }
}

const stalls: ForkChatStallEntry[] = [
  { sessionId: 'stuck', quietSince: NOW - 45 * 60_000, liveness: 'stopped' },
  { sessionId: 'both', quietSince: NOW - 40 * 60_000, liveness: 'alive' },
  // A terminal agent's pane key is never a stall session id; one here must not mark it.
  { sessionId: 'term', quietSince: NOW - 40 * 60_000, liveness: 'alive' }
]

const queue: ForkAgentQueueEntry[] = [
  {
    id: 't1',
    sessionId: 'waiting',
    label: 'waiting chat',
    kind: 'interactive',
    position: 1,
    queuedAt: NOW - 5_000,
    heldReason: FORK_AGENT_QUEUE_MEMORY_HOLD_REASON
  },
  {
    id: 't2',
    sessionId: 'both',
    label: 'both',
    kind: 'interactive',
    position: 2,
    queuedAt: NOW - 4_000
  },
  {
    id: 't3',
    sessionId: 'unseen',
    label: 'not in ps yet',
    kind: 'worker',
    position: 3,
    queuedAt: NOW - 3_000
  }
]

function build() {
  return buildSleeperRows(
    [
      source({ id: 'stuck' }),
      source({ id: 'both' }),
      source({ id: 'waiting', status: null, processAlive: false }),
      source({ id: 'term', kind: 'terminal', status: 'done' }),
      source({ id: 'idle', status: 'done' })
    ],
    {
      now: NOW,
      pinned: new Set(['unseen']),
      onScreen: new Set(),
      ...sleeperLifecycleOverlay(stalls, queue)
    }
  )
}

function byId(id: string) {
  const row = build().find((candidate) => candidate.id === id)
  if (!row) {
    throw new Error(`no row ${id}`)
  }
  return row
}

describe('sleeper lifecycle rows', () => {
  it('marks a stalled chat with the stall facts its actions need', () => {
    const row = byId('stuck')
    expect(row.state).toBe('stalled')
    expect(row.stall).toEqual({
      quietSince: NOW - 45 * 60_000,
      liveness: 'stopped'
    })
    expect(row.idleMs).toBeNull()
    expect(row.queue).toBeUndefined()
    expect(canSleepNow(row)).toBe(false)
  })

  it('marks a queued chat with its ticket id, place and hold reason', () => {
    const row = byId('waiting')
    expect(row.state).toBe('queued')
    expect(row.queue).toEqual({
      id: 't1',
      position: 1,
      heldReason: FORK_AGENT_QUEUE_MEMORY_HOLD_REASON
    })
    expect(row.idleMs).toBeNull()
    expect(canSleepNow(row)).toBe(false)
  })

  it('a chat both queued and stalled shows as queued, never twice', () => {
    const rows = build().filter((row) => row.id === 'both')
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('queued')
    expect(rows[0].stall).toBeUndefined()
  })

  it('lists a queued launch no source shows yet, with no workspace to open or close', () => {
    const row = byId('unseen')
    expect(row).toMatchObject({
      state: 'queued',
      title: 'not in ps yet',
      worktreeId: null,
      local: true,
      pinned: true,
      queue: { id: 't3', position: 3 }
    })
  })

  it('leaves terminal agents and plain chats to their own state', () => {
    expect(byId('term').state).toBe('awake-idle')
    expect(byId('term').stall).toBeUndefined()
    expect(byId('idle').state).toBe('awake-idle')
  })

  it('filters and sorts on the new states', () => {
    const rows = build()
    expect(filterSleepers(rows, { states: ['stalled'] }).map((row) => row.id)).toEqual(['stuck'])
    expect(
      filterSleepers(rows, { states: ['queued'] })
        .map((row) => row.id)
        .sort()
    ).toEqual(['both', 'unseen', 'waiting'])
    const order = sortSleepers(rows, 'state', false).map((row) => row.state)
    expect(order).toEqual(
      [...order].sort((a, b) => SLEEPER_STATES.indexOf(a) - SLEEPER_STATES.indexOf(b))
    )
    expect(SLEEPER_STATES).toEqual([
      'working',
      'stalled',
      'needs-input',
      'queued',
      'awake-idle',
      'asleep'
    ])
  })

  it('an empty overlay changes nothing', () => {
    const rows = buildSleeperRows([source({ id: 'a' })], {
      now: NOW,
      pinned: new Set(),
      onScreen: new Set(),
      ...sleeperLifecycleOverlay([], [])
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('working')
    expect('stall' in rows[0] || 'queue' in rows[0]).toBe(false)
  })
})

describe('forkSleepersButtonShown', () => {
  it('shows the button unless the setting is false', () => {
    expect(forkSleepersButtonShown(undefined)).toBe(true)
    expect(forkSleepersButtonShown({})).toBe(true)
    expect(forkSleepersButtonShown({ forkSleepersButton: true })).toBe(true)
    expect(forkSleepersButtonShown({ forkSleepersButton: false })).toBe(false)
  })
})
