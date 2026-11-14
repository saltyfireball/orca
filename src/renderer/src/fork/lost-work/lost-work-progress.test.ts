// SLRM-2175: how the Lost work list takes rows from a scan that is still running.
import { describe, expect, it } from 'vitest'
import type { LostWorkItem, LostWorkScanResult } from '../../../../shared/fork/lost-work'
import { lostWorkProgressName, mergeLostWorkProgress } from './lost-work-progress'

function item(repoId: string, branch: string): LostWorkItem {
  return {
    id: `branch:${repoId}:${branch}`,
    kind: 'branch',
    risk: 'needs-look',
    reasons: ['unmerged-commits'],
    repoId,
    repoName: repoId,
    branch,
    unmergedCommits: 1,
    unpushedCommits: 0,
    dirtyFiles: null,
    lastCommitAt: null
  }
}

describe('mergeLostWorkProgress', () => {
  it('starts a list from the first repository that finishes', () => {
    const merged = mergeLostWorkProgress(
      null,
      { repoIds: ['a'], items: [item('a', 'one')], notes: [] },
      42
    )
    expect(merged).toEqual({ scannedAt: 42, items: [item('a', 'one')], notes: [] })
  })

  it('replaces the rows and notes of finished projects and keeps the rest', () => {
    const previous: LostWorkScanResult = {
      scannedAt: 1,
      items: [item('a', 'old'), item('b', 'kept'), item('c', 'gone')],
      notes: [
        { repoId: 'a', repoName: 'a', code: 'git-error', detail: 'x' },
        { repoId: 'b', repoName: 'b', code: 'no-default-branch' }
      ]
    }
    const merged = mergeLostWorkProgress(
      previous,
      {
        repoIds: ['a', 'c'],
        items: [item('a', 'new')],
        notes: [{ repoId: 'c', repoName: 'c', code: 'shared-repository', detail: 'a' }]
      },
      99
    )
    expect(merged.scannedAt).toBe(1)
    expect(merged.items.map((entry) => entry.id)).toEqual(['branch:b:kept', 'branch:a:new'])
    expect(merged.notes.map((note) => `${note.repoId}:${note.code}`)).toEqual([
      'b:no-default-branch',
      'c:shared-repository'
    ])
  })
})

describe('lostWorkProgressName', () => {
  it('names one project and counts the others', () => {
    expect(lostWorkProgressName([])).toBe('')
    expect(lostWorkProgressName(['alpha'])).toBe('alpha')
    expect(lostWorkProgressName(['alpha', 'beta', 'gamma'])).toBe('alpha +2')
  })
})
