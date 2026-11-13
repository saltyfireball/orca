// Sleepers (FORK.md): the `orca sleepers` table, ids and sleep results.
import { describe, expect, it } from 'vitest'
import type { SleeperRow } from '../../shared/fork/sleepers'
import {
  formatDuration,
  formatSleepers,
  formatSleepOutcomes,
  pickSleeper
} from './sleepers-handlers'

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

describe('formatDuration', () => {
  it('prints minutes, hours and days', () => {
    expect(formatDuration(null)).toBe('-')
    expect(formatDuration(30_000)).toBe('<1m')
    expect(formatDuration(5 * 60_000)).toBe('5m')
    expect(formatDuration(125 * 60_000)).toBe('2h05m')
    expect(formatDuration(72 * 3_600_000)).toBe('3d')
  })
})

describe('formatSleepers', () => {
  it('says when there is nothing', () => {
    expect(formatSleepers({ now: 0, rows: [] })).toBe('No chats or terminal agents.')
  })

  it('lists the longest idle first, with short chat ids and marks', () => {
    const text = formatSleepers({
      now: 10 * 60_000,
      rows: [
        row({ id: 'aaaaaaaa-1111', title: 'Short', idleMs: 60_000, lastActivityAt: 9 * 60_000 }),
        row({
          id: 'bbbbbbbb-2222',
          title: 'Long',
          idleMs: 5 * 60_000,
          model: 'opus',
          pinned: true,
          onScreen: true
        }),
        row({ id: 'tab-1:leaf-1', kind: 'terminal', state: 'working', idleMs: null, local: false })
      ]
    })
    const lines = text.split('\n')
    expect(lines[0]).toMatch(
      /^ID\s+KIND\s+STATE\s+IDLE\s+LAST ACTIVITY\s+WORKSPACE\s+MODEL\s+TITLE$/
    )
    expect(lines[1]).toMatch(
      /^bbbbbbbb\s+chat\s+awake idle\s+5m\s+10m ago\s+alpha\s+opus\s+Long\s+pinned, on screen$/
    )
    expect(lines[2]).toMatch(/^aaaaaaaa\s+chat\s+awake idle\s+1m\s+1m ago/)
    expect(lines[3]).toMatch(/^tab-1:leaf-1\s+terminal\s+working\s+-.*remote$/)
  })
})

describe('pickSleeper', () => {
  const rows = [row({ id: 'abc-1' }), row({ id: 'abd-2' })]

  it('finds an id or unique prefix', () => {
    expect(pickSleeper(rows, 'abd').id).toBe('abd-2')
  })

  it('explains a missing, ambiguous or unknown id', () => {
    expect(() => pickSleeper(rows, undefined)).toThrow(/Name a chat/)
    expect(() => pickSleeper(rows, 'ab')).toThrow(/matches 2 agents/)
    expect(() => pickSleeper(rows, 'zz')).toThrow(/No chat or agent/)
  })
})

describe('formatSleepOutcomes', () => {
  it('names each chat and says why it stayed awake', () => {
    const text = formatSleepOutcomes(
      {
        outcomes: [
          { sessionId: 'a', result: 'asleep' },
          { sessionId: 'b', result: 'busy' }
        ]
      },
      new Map([['a', 'Plan']])
    )
    expect(text).toBe(
      'Plan: asleep\nb: left awake: it has work in flight (a turn, a question, queued messages or subagents)'
    )
    expect(formatSleepOutcomes({ outcomes: [] }, new Map())).toBe('No idle chats to sleep.')
  })
})
