// Sleepers (FORK.md): what the dialog lays over the host rows, and what a bulk action touches.
import { describe, expect, it } from 'vitest'
import type { SleeperRow } from '../../../../shared/fork/sleepers'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-resume'
import type { MemorySnapshot } from '../../../../shared/process-stats-types'
import {
  formatSleeperBytes,
  mergeSleeperRows,
  sleeperBulkTargets,
  sleeperMemoryByPaneKey,
  sleeperWorkspaces,
  type SleepersRendererFacts
} from './sleepers-view-model'

function row(over: Partial<SleeperRow> & { id: string }): SleeperRow {
  return {
    kind: 'chat',
    paneKey: `pane-${over.id}`,
    worktreeId: 'w1',
    workspace: 'alpha',
    title: over.id,
    agent: 'claude',
    model: null,
    stateStartedAt: 0,
    updatedAt: 0,
    local: true,
    state: 'awake-idle',
    idleMs: 0,
    lastActivityAt: 0,
    pinned: false,
    onScreen: false,
    memoryBytes: null,
    ...over
  }
}

function record(over: Partial<SleepingAgentSessionRecord>): SleepingAgentSessionRecord {
  return {
    paneKey: 'tab-z:leaf',
    worktreeId: 'w2',
    agent: 'codex',
    prompt: 'resume me',
    capturedAt: 100,
    updatedAt: 200,
    ...over
  } as SleepingAgentSessionRecord
}

function facts(over: Partial<SleepersRendererFacts> = {}): SleepersRendererFacts {
  return {
    now: 1_000,
    onScreenChatIds: new Set(),
    pinned: new Set(),
    memoryByPaneKey: new Map(),
    sleepingRecords: {},
    workspaceName: (id) => `name-${id}`,
    ...over
  }
}

describe('mergeSleeperRows', () => {
  it('lays screen, live pins and memory over the host rows', () => {
    const [chat, term] = mergeSleeperRows(
      [row({ id: 'c1', pinned: true }), row({ id: 't1', kind: 'terminal', paneKey: 'tab-t:leaf' })],
      facts({
        onScreenChatIds: new Set(['c1']),
        pinned: new Set(['t1']),
        memoryByPaneKey: new Map([['pane-c1', 42]])
      })
    )
    expect(chat).toMatchObject({ onScreen: true, pinned: false, memoryBytes: 42 })
    expect(term.pinned).toBe(false)
  })

  it('marks a hibernated terminal asleep and adds slept terminals the host no longer lists', () => {
    const merged = mergeSleeperRows(
      [row({ id: 'tab-t:leaf', kind: 'terminal', paneKey: 'tab-t:leaf', state: 'awake-idle' })],
      facts({
        sleepingRecords: {
          'tab-t:leaf': record({ paneKey: 'tab-t:leaf' }),
          'tab-z:leaf': record({ terminalTitle: ' Codex run ', connectionId: 'ssh-1' }),
          'tab-q:leaf': record({ paneKey: 'tab-q:leaf', origin: 'quit' })
        }
      })
    )
    expect(merged.map((r) => r.id)).toEqual(['tab-t:leaf', 'tab-z:leaf'])
    expect(merged[0].state).toBe('asleep')
    expect(merged[1]).toMatchObject({
      kind: 'terminal',
      state: 'asleep',
      title: 'Codex run',
      workspace: 'name-w2',
      local: false,
      idleMs: 900
    })
  })
})

describe('helpers', () => {
  it('sums memory per pane and skips panes with no key', () => {
    const snapshot = {
      worktrees: [
        { sessions: [{ paneKey: 'p', memory: 1 }, { paneKey: 'p', memory: 2 }, { memory: 9 }] }
      ]
    } as unknown as MemorySnapshot
    expect(sleeperMemoryByPaneKey(snapshot)).toEqual(new Map([['p', 3]]))
    expect(sleeperMemoryByPaneKey(null).size).toBe(0)
  })

  it('lists workspaces once, by name', () => {
    const list = sleeperWorkspaces([
      row({ id: 'a', worktreeId: 'w2', workspace: 'zeta' }),
      row({ id: 'b', worktreeId: 'w1', workspace: 'alpha' }),
      row({ id: 'c', worktreeId: 'w2', workspace: 'zeta' }),
      row({ id: 'd', worktreeId: null })
    ])
    expect(list).toEqual([
      { worktreeId: 'w1', name: 'alpha' },
      { worktreeId: 'w2', name: 'zeta' }
    ])
  })

  it('formats bytes', () => {
    expect(formatSleeperBytes(null)).toBe('')
    expect(formatSleeperBytes(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatSleeperBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
  })
})

describe('sleeperBulkTargets', () => {
  const rows = [
    row({ id: 'idle' }),
    row({ id: 'busy', state: 'working' }),
    row({ id: 'pinned', pinned: true }),
    row({ id: 'remote', local: false }),
    row({ id: 'term', kind: 'terminal' }),
    row({ id: 'loose', worktreeId: null })
  ]
  const all = new Set(rows.map((r) => r.id))
  const ids = (action: Parameters<typeof sleeperBulkTargets>[2]) =>
    sleeperBulkTargets(rows, all, action).map((r) => r.id)

  it('applies each action only where it can act', () => {
    expect(ids('sleep')).toEqual(['idle', 'pinned', 'loose'])
    expect(ids('pin')).toEqual(['idle', 'busy', 'loose'])
    expect(ids('unpin')).toEqual(['pinned'])
    expect(ids('close')).toEqual(['idle', 'busy', 'pinned', 'remote', 'term'])
  })

  it('ignores rows that are not selected', () => {
    expect(sleeperBulkTargets(rows, new Set(['busy']), 'sleep')).toEqual([])
  })
})
