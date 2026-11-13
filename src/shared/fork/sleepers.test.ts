// Sleepers (FORK.md): the list, its filters and sort, and which rows the bulk actions touch.
import { describe, expect, it } from 'vitest'
import {
  buildSleeperRows,
  canSleepNow,
  deriveSleeperState,
  filterSleepers,
  FORK_SLEEPERS_MAX_PINNED,
  normalizeForkSleepersPinned,
  readForkSleepersPinned,
  resolveSleeper,
  selectSleepAllIdle,
  selectSleepExceptVisible,
  sortSleepers,
  withForkSleeperPinned,
  type SleeperSource
} from './sleepers'

const NOW = 10_000_000

function source(over: Partial<SleeperSource> & { id: string }): SleeperSource {
  return {
    kind: 'chat',
    paneKey: `pane-${over.id}`,
    worktreeId: 'w1',
    workspace: 'alpha',
    title: over.id,
    agent: 'claude',
    model: null,
    status: 'done',
    stateStartedAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    processAlive: true,
    local: true,
    ...over
  }
}

function rows(sources: SleeperSource[], pinned: string[] = [], onScreen: string[] = []) {
  return buildSleeperRows(sources, {
    now: NOW,
    pinned: new Set(pinned),
    onScreen: new Set(onScreen),
    memoryByPaneKey: new Map([['pane-a', 2048]])
  })
}

describe('deriveSleeperState', () => {
  it('maps status and process to a state', () => {
    expect(deriveSleeperState({ status: 'working', processAlive: true })).toBe('working')
    expect(deriveSleeperState({ status: 'blocked', processAlive: true })).toBe('needs-input')
    expect(deriveSleeperState({ status: 'waiting', processAlive: true })).toBe('needs-input')
    expect(deriveSleeperState({ status: 'done', processAlive: true })).toBe('awake-idle')
    expect(deriveSleeperState({ status: null, processAlive: true })).toBe('awake-idle')
    expect(deriveSleeperState({ status: 'done', processAlive: false })).toBe('asleep')
    expect(deriveSleeperState({ status: 'working', processAlive: false })).toBe('asleep')
    expect(deriveSleeperState({ status: 'working', processAlive: true, hibernated: true })).toBe(
      'asleep'
    )
  })
})

describe('buildSleeperRows', () => {
  it('drops duplicates, sets idle time only when idle, and lays pins, screen and memory over', () => {
    const built = rows(
      [
        source({ id: 'a' }),
        source({ id: 'a', title: 'second copy' }),
        source({ id: 'b', status: 'working' }),
        source({ id: 't', kind: 'terminal' })
      ],
      ['a', 't'],
      ['b']
    )
    expect(built.map((row) => row.id)).toEqual(['a', 'b', 't'])
    const [a, b, t] = built
    expect(a).toMatchObject({
      state: 'awake-idle',
      idleMs: 60_000,
      pinned: true,
      memoryBytes: 2048
    })
    expect(a.title).toBe('a')
    expect(b).toMatchObject({ state: 'working', idleMs: null, onScreen: true, memoryBytes: null })
    // Terminals are never pinned: pins only hold native chats.
    expect(t.pinned).toBe(false)
    expect('status' in a).toBe(false)
  })
})

describe('filter and sort', () => {
  const list = rows([
    source({ id: 'a', stateStartedAt: NOW - 10 * 60_000, updatedAt: 3 }),
    source({ id: 'b', worktreeId: 'w2', workspace: 'beta', processAlive: false, updatedAt: 1 }),
    source({ id: 'c', status: 'blocked', updatedAt: 2 })
  ])

  it('filters by state, workspace and idle time', () => {
    expect(filterSleepers(list, { states: ['asleep'] }).map((r) => r.id)).toEqual(['b'])
    expect(filterSleepers(list, { worktreeId: 'w2' }).map((r) => r.id)).toEqual(['b'])
    expect(filterSleepers(list, { minIdleMs: 5 * 60_000 }).map((r) => r.id)).toEqual(['a'])
    expect(filterSleepers(list, { states: [], worktreeId: null }).length).toBe(3)
  })

  it('sorts by idle, activity, workspace and state in either direction', () => {
    expect(sortSleepers(list, 'idle', true).map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(sortSleepers(list, 'activity', false).map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(sortSleepers(list, 'workspace', true).map((r) => r.id)).toEqual(['b', 'a', 'c'])
    expect(sortSleepers(list, 'state', false).map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('sleep selections', () => {
  const list = rows(
    [
      source({ id: 'idle' }),
      source({ id: 'pinned' }),
      source({ id: 'visible' }),
      source({ id: 'busy', status: 'working' }),
      source({ id: 'asking', status: 'waiting' }),
      source({ id: 'asleep', processAlive: false }),
      source({ id: 'remote', local: false }),
      source({ id: 'term', kind: 'terminal' })
    ],
    ['pinned'],
    ['visible']
  )

  it('only offers sleep now on idle local chats', () => {
    expect(list.filter(canSleepNow).map((r) => r.id)).toEqual(['idle', 'pinned', 'visible'])
  })

  it('sleep all idle skips pinned, busy, asking, asleep, remote and terminal rows', () => {
    expect(selectSleepAllIdle(list).map((r) => r.id)).toEqual(['idle', 'visible'])
  })

  it('sleep all except visible also skips chats on screen', () => {
    expect(selectSleepExceptVisible(list).map((r) => r.id)).toEqual(['idle'])
  })
})

describe('resolveSleeper', () => {
  const list = rows([source({ id: 'abc123' }), source({ id: 'abd456' }), source({ id: 'abc' })])

  it('takes an exact id before a prefix', () => {
    expect(resolveSleeper(list, 'abc')).toMatchObject({ ok: true, row: { id: 'abc' } })
  })

  it('takes a unique prefix and reports ambiguous or missing ones', () => {
    expect(resolveSleeper(list, 'abd')).toMatchObject({ ok: true, row: { id: 'abd456' } })
    expect(resolveSleeper(list, 'ab')).toMatchObject({ ok: false, error: 'ambiguous' })
    expect(resolveSleeper(list, 'zz')).toMatchObject({ ok: false, error: 'not-found' })
    expect(resolveSleeper(list, '')).toMatchObject({ ok: false, error: 'not-found' })
  })
})

describe('pin list', () => {
  it('keeps distinct nonempty strings up to the cap', () => {
    expect(normalizeForkSleepersPinned(['a', 'a', '', 3, 'b'])).toEqual(['a', 'b'])
    expect(normalizeForkSleepersPinned('a')).toEqual([])
    const many = Array.from({ length: FORK_SLEEPERS_MAX_PINNED + 5 }, (_, i) => `s${i}`)
    expect(normalizeForkSleepersPinned(many)).toHaveLength(FORK_SLEEPERS_MAX_PINNED)
  })

  it('reads any settings shape and defaults to none', () => {
    expect(readForkSleepersPinned(null)).toEqual([])
    expect(readForkSleepersPinned({})).toEqual([])
    expect(readForkSleepersPinned({ forkSleepersPinned: ['x'] })).toEqual(['x'])
  })

  it('pins and unpins one chat without touching the rest', () => {
    const settings = { forkSleepersPinned: ['a', 'b'] }
    expect(withForkSleeperPinned(settings, 'c', true)).toEqual({
      forkSleepersPinned: ['a', 'b', 'c']
    })
    expect(withForkSleeperPinned(settings, 'a', true)).toEqual({ forkSleepersPinned: ['b', 'a'] })
    expect(withForkSleeperPinned(settings, 'a', false)).toEqual({ forkSleepersPinned: ['b'] })
    expect(withForkSleeperPinned({}, 'a', false)).toEqual({ forkSleepersPinned: [] })
  })
})
