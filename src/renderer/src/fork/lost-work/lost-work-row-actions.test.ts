// SLRM-2230: the action a Lost work row suggests first.
import { describe, expect, it } from 'vitest'
import type { LostWorkItem } from '../../../../shared/fork/lost-work'
import { lostWorkRowActions, suggestLostWorkAction } from './lost-work-row-actions'

function item(over: Partial<LostWorkItem>): LostWorkItem {
  return {
    id: 'x',
    kind: 'worktree',
    risk: 'needs-look',
    reasons: [],
    repoId: 'r',
    repoName: 'alpha',
    worktreeId: 'r::/w/x',
    path: '/w/x',
    branch: 'feat',
    unmergedCommits: 0,
    unpushedCommits: 0,
    dirtyFiles: 0,
    lastCommitAt: null,
    ...over
  }
}

const open = { number: 7, state: 'open' as const, url: 'https://example.test/7' }

describe('suggestLostWorkAction', () => {
  it('pushes commits that are on no remote', () => {
    expect(
      suggestLostWorkAction(
        item({
          reasons: ['unmerged-commits', 'unpushed-commits'],
          unmergedCommits: 3,
          unpushedCommits: 2
        })
      )
    ).toBe('push')
  })

  it('pushes when the scan could not tell whether the commits are on a remote', () => {
    expect(
      suggestLostWorkAction(
        item({ reasons: ['unmerged-commits'], unmergedCommits: 3, unpushedCommits: null })
      )
    ).toBe('push')
  })

  it('saves a bundle for unpushed commits on a detached HEAD', () => {
    expect(
      suggestLostWorkAction(
        item({
          branch: null,
          reasons: ['detached-head', 'unmerged-commits', 'unpushed-commits'],
          unmergedCommits: 1,
          unpushedCommits: 1
        })
      )
    ).toBe('bundle')
  })

  it('opens a pull request for pushed commits, with or without one', () => {
    const pushed = { reasons: ['unmerged-commits' as const], unmergedCommits: 2 }
    expect(suggestLostWorkAction(item(pushed))).toBe('pull-request')
    expect(
      suggestLostWorkAction(
        item({ reasons: ['unmerged-commits', 'pr-open'], unmergedCommits: 2, pullRequest: open })
      )
    ).toBe('pull-request')
  })

  it('views an open pull request whose commits already merged', () => {
    expect(suggestLostWorkAction(item({ reasons: ['merged', 'pr-open'], pullRequest: open }))).toBe(
      'pull-request'
    )
  })

  it('opens a workspace with uncommitted files before anything else', () => {
    expect(
      suggestLostWorkAction(
        item({
          reasons: ['unmerged-commits', 'unpushed-commits', 'dirty-files'],
          unmergedCommits: 1,
          unpushedCommits: 1,
          dirtyFiles: 4
        })
      )
    ).toBe('open')
  })

  it('saves a patch for uncommitted files in a worktree Orca cannot open', () => {
    expect(
      suggestLostWorkAction(
        item({ kind: 'untracked-worktree', reasons: ['not-tracked', 'dirty-files'], dirtyFiles: 1 })
      )
    ).toBe('patch')
  })

  it('saves a stash as a patch', () => {
    expect(suggestLostWorkAction(item({ kind: 'stash', reasons: ['stash'], branch: null }))).toBe(
      'patch'
    )
  })

  it('deletes merged work', () => {
    for (const reason of ['merged', 'squash-merged', 'pr-merged', 'pr-closed'] as const) {
      expect(suggestLostWorkAction(item({ risk: 'safe', reasons: [reason] }))).toBe('delete')
    }
  })

  it('forgets a folder that is gone, even with unmerged commits', () => {
    expect(
      suggestLostWorkAction(
        item({
          kind: 'missing-folder',
          risk: 'safe',
          reasons: ['folder-missing', 'unmerged-commits'],
          unmergedCommits: 2
        })
      )
    ).toBe('delete')
  })

  it('opens a merged workspace that is in use instead of deleting it', () => {
    expect(
      suggestLostWorkAction(
        item({
          reasons: ['pr-merged'],
          inUse: {
            agentRunning: false,
            openChats: 2,
            sleepingChats: 0,
            liveTerminals: 0,
            active: false
          }
        })
      )
    ).toBe('open')
  })

  it('opens a workspace it cannot compare with a default branch', () => {
    expect(suggestLostWorkAction(item({ reasons: ['unknown-base'], unmergedCommits: null }))).toBe(
      'open'
    )
  })
})

describe('lostWorkRowActions', () => {
  it('always offers the suggested action', () => {
    const rows = [
      item({ reasons: ['merged'] }),
      item({ kind: 'stash', reasons: ['stash'], branch: null }),
      item({ kind: 'missing-folder', reasons: ['folder-missing'] }),
      item({ kind: 'branch', reasons: ['unmerged-commits'], unmergedCommits: 1 }),
      item({ kind: 'untracked-worktree', reasons: ['not-tracked', 'dirty-files'] })
    ]
    for (const row of rows) {
      expect(lostWorkRowActions(row)).toContain(suggestLostWorkAction(row))
    }
  })
})
