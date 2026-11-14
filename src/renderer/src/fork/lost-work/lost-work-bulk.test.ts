// SLRM-2230: selecting, grouping and confirming many Lost work rows.
import { describe, expect, it } from 'vitest'
import type { LostWorkItem } from '../../../../shared/fork/lost-work'
import {
  groupLostWorkByProject,
  lostWorkFilterCounts,
  lostWorkKindCounts,
  lostWorkSelectAllState,
  nextLostWorkDeleteStage,
  toggleLostWorkSelectAll
} from './lost-work-bulk'

const USE = { agentRunning: false, openChats: 1, sleepingChats: 0, liveTerminals: 0, active: false }

function item(id: string, over: Partial<LostWorkItem> = {}): LostWorkItem {
  return {
    id,
    kind: 'worktree',
    risk: 'safe',
    reasons: ['merged'],
    repoId: 'r',
    repoName: 'alpha',
    unmergedCommits: 0,
    unpushedCommits: 0,
    dirtyFiles: 0,
    lastCommitAt: null,
    ...over
  }
}

describe('select all', () => {
  const rows = [item('a'), item('b'), item('busy', { risk: 'needs-look', inUse: USE })]

  it('ticks every row except the ones in use', () => {
    expect([...toggleLostWorkSelectAll(rows, new Set())].sort()).toEqual(['a', 'b'])
  })

  it('reads ticked once every selectable row is, and part-ticked before that', () => {
    expect(lostWorkSelectAllState(rows, new Set())).toBe(false)
    expect(lostWorkSelectAllState(rows, new Set(['a']))).toBe('indeterminate')
    expect(lostWorkSelectAllState(rows, new Set(['a', 'b']))).toBe(true)
  })

  it('stays part-ticked when only a row in use is ticked by hand', () => {
    expect(lostWorkSelectAllState([rows[2]], new Set(['busy']))).toBe('indeterminate')
  })

  it('clears the shown rows, hand-ticked ones too, and keeps rows that are not shown', () => {
    const cleared = toggleLostWorkSelectAll(rows, new Set(['a', 'b', 'busy', 'elsewhere']))
    expect([...cleared]).toEqual(['elsewhere'])
  })
})

describe('nextLostWorkDeleteStage', () => {
  it('runs a delete of safe rows after one confirmation', () => {
    expect(nextLostWorkDeleteStage([item('a')], 'confirm')).toBeNull()
  })

  it('asks again for rows in use, then for rows that would lose work', () => {
    const rows = [
      item('a'),
      item('busy', { risk: 'needs-look', inUse: USE }),
      item('loss', { risk: 'would-lose-work' })
    ]
    expect(nextLostWorkDeleteStage(rows, 'confirm')).toBe('in-use')
    expect(nextLostWorkDeleteStage(rows, 'in-use')).toBe('loss')
    expect(nextLostWorkDeleteStage(rows, 'loss')).toBeNull()
  })

  it('skips the in-use question when nothing is in use', () => {
    expect(nextLostWorkDeleteStage([item('loss', { risk: 'would-lose-work' })], 'confirm')).toBe(
      'loss'
    )
  })
})

describe('counts and groups', () => {
  const rows = [
    item('a', { repoId: 'r2', repoName: 'beta', lastCommitAt: 1 }),
    item('b', { repoId: 'r1', repoName: 'alpha', kind: 'branch', risk: 'needs-look' }),
    item('c', { repoId: 'r2', repoName: 'beta', kind: 'missing-folder', lastCommitAt: 5 }),
    item('d', { repoId: 'r2', repoName: 'beta', kind: 'stash', risk: 'would-lose-work' })
  ]

  it('counts rows per filter and per kind', () => {
    expect(lostWorkFilterCounts(rows)).toEqual({
      all: 4,
      safe: 2,
      'needs-look': 1,
      'would-lose-work': 1
    })
    expect(lostWorkKindCounts(rows)).toEqual({
      worktree: 1,
      'untracked-worktree': 0,
      'missing-folder': 1,
      branch: 1,
      stash: 1
    })
  })

  it('groups by project name, riskiest then newest first inside each', () => {
    const groups = groupLostWorkByProject(rows)
    expect(groups.map((group) => group.repoName)).toEqual(['alpha', 'beta'])
    expect(groups[1].items.map((row) => row.id)).toEqual(['d', 'c', 'a'])
  })
})
