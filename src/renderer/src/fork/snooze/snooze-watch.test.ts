import { describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import type { ForkSnoozeEntry } from '../../../../shared/fork/snooze'
import { readForkSnoozeFacts } from './snooze-watch'
import { forkWithoutSnoozedWorktrees } from './use-fork-snooze'
import { fromLocalInputValue, toLocalInputValue } from './ForkSnoozeCustomDialog'

vi.mock('@/store', () => ({ useAppStore: { getState: vi.fn() } }))

const CHAT: ForkSnoozeEntry = {
  id: 'abcdef123456',
  target: { kind: 'chat', paneKey: 'tab-1:leaf-1', worktreeId: 'w1', hostId: 'local' },
  until: { kind: 'time', at: 10_000 },
  label: 'chat',
  snoozedAt: 1000
}

function status(over: Partial<AgentStatusEntry>): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: 1500,
    stateStartedAt: 1500,
    paneKey: 'tab-1:leaf-1',
    stateHistory: [],
    ...over
  } as AgentStatusEntry
}

function stateWith(entry: AgentStatusEntry | undefined): AppState {
  const map = new Map(entry ? [[entry.paneKey, entry]] : [])
  return { agentStatusByPaneKey: map } as unknown as AppState
}

const here = { worktreeId: 'w1', paneKey: null }

describe('readForkSnoozeFacts for a chat', () => {
  it('sees a question asked after the snooze and the last activity', () => {
    const facts = readForkSnoozeFacts(
      stateWith(status({ state: 'waiting', stateStartedAt: 2000, updatedAt: 2100 })),
      CHAT,
      { now: 3000, previous: here, current: here }
    )
    expect(facts).toMatchObject({ opened: false, attentionSince: 2000, lastActivityAt: 2100 })
  })

  it('counts as opened only when focus moves onto it', () => {
    const onIt = { worktreeId: 'w1', paneKey: 'tab-1:leaf-1' }
    expect(
      readForkSnoozeFacts(stateWith(undefined), CHAT, { now: 1, previous: here, current: onIt })
        .opened
    ).toBe(true)
    expect(
      readForkSnoozeFacts(stateWith(undefined), CHAT, { now: 1, previous: onIt, current: onIt })
        .opened
    ).toBe(false)
  })
})

describe('forkWithoutSnoozedWorktrees', () => {
  const list = [
    { id: 'a', hostId: 'local' },
    { id: 'b', hostId: undefined },
    { id: 'a', hostId: 'runtime:srv' }
  ]

  it('keeps the same array when nothing is snoozed', () => {
    expect(forkWithoutSnoozedWorktrees(list, new Set())).toBe(list)
    expect(forkWithoutSnoozedWorktrees(list, new Set(['local\u0000zzz']))).toBe(list)
  })

  it('drops a snoozed workspace on its own host only', () => {
    expect(forkWithoutSnoozedWorktrees(list, new Set(['runtime:srv\u0000a']))).toEqual([
      { id: 'a', hostId: 'local' },
      { id: 'b', hostId: undefined }
    ])
    expect(forkWithoutSnoozedWorktrees(list, new Set(['local\u0000b']))).toHaveLength(2)
  })
})

describe('custom time field', () => {
  it('round-trips a local date and time', () => {
    const at = new Date(2026, 10, 20, 9, 5).getTime()
    expect(toLocalInputValue(at)).toBe('2026-11-20T09:05')
    expect(fromLocalInputValue('2026-11-20T09:05')).toBe(at)
    expect(fromLocalInputValue('')).toBeNull()
  })
})
