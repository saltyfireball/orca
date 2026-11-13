// SLRM-2096: the risk rules, without git.
import { describe, expect, it } from 'vitest'
import { classifyLostWork, type LostWorkFacts } from './lost-work-classify'

const base: LostWorkFacts = {
  kind: 'worktree',
  dirtyFiles: 0,
  unmergedCommits: 0,
  unpushedCommits: 0,
  squashMerged: null
}

describe('classifyLostWork', () => {
  it('marks merged clean work safe and finished', () => {
    expect(classifyLostWork(base)).toEqual({
      risk: 'safe',
      reasons: ['merged'],
      unmergedCommits: 0,
      finished: true
    })
  })

  it('says unpushed unmerged commits would lose work', () => {
    const result = classifyLostWork({ ...base, unmergedCommits: 2, unpushedCommits: 1 })
    expect(result.risk).toBe('would-lose-work')
    expect(result.reasons).toEqual(['unmerged-commits', 'unpushed-commits'])
    expect(result.finished).toBe(false)
  })

  it('treats pushed but unmerged commits as needing a look', () => {
    expect(classifyLostWork({ ...base, unmergedCommits: 2, unpushedCommits: 0 }).risk).toBe(
      'needs-look'
    )
  })

  it('treats a squash merge as merged', () => {
    const result = classifyLostWork({
      ...base,
      unmergedCommits: 3,
      unpushedCommits: 3,
      squashMerged: true
    })
    expect(result).toMatchObject({ risk: 'safe', unmergedCommits: 0, finished: true })
    expect(result.reasons).toEqual(['squash-merged'])
  })

  it('counts only commits past a merged pull request', () => {
    const pr = { number: 1, state: 'merged' as const, url: 'https://example.test/1' }
    expect(
      classifyLostWork({
        ...base,
        unmergedCommits: 4,
        unpushedCommits: 0,
        pullRequest: pr,
        commitsPastPullRequest: 0
      })
    ).toMatchObject({ risk: 'safe', unmergedCommits: 0, reasons: ['pr-merged'] })
    expect(
      classifyLostWork({
        ...base,
        unmergedCommits: 4,
        unpushedCommits: 1,
        pullRequest: pr,
        commitsPastPullRequest: 1
      })
    ).toMatchObject({ risk: 'would-lose-work', unmergedCommits: 1 })
  })

  it('lets a closed pull request with pushed commits be removed, and holds an open one', () => {
    const closed = { number: 2, state: 'closed' as const, url: 'https://example.test/2' }
    expect(
      classifyLostWork({ ...base, unmergedCommits: 1, unpushedCommits: 0, pullRequest: closed })
    ).toMatchObject({ risk: 'safe', finished: true })
    const open = { ...closed, state: 'open' as const }
    expect(classifyLostWork({ ...base, pullRequest: open }).risk).toBe('needs-look')
  })

  it('says uncommitted files would lose work, and unreadable ones need a look', () => {
    expect(classifyLostWork({ ...base, dirtyFiles: 3 }).risk).toBe('would-lose-work')
    expect(classifyLostWork({ ...base, dirtyFiles: null }).risk).toBe('needs-look')
  })

  it('needs a look without a base to compare with', () => {
    expect(
      classifyLostWork({ ...base, unmergedCommits: null, unpushedCommits: null })
    ).toMatchObject({ risk: 'needs-look', reasons: ['unknown-base'] })
  })

  it('keeps missing folders safe and stashes at would lose work', () => {
    expect(
      classifyLostWork({ ...base, kind: 'missing-folder', unmergedCommits: 5, unpushedCommits: 5 })
        .risk
    ).toBe('safe')
    expect(classifyLostWork({ ...base, kind: 'stash' })).toMatchObject({
      risk: 'would-lose-work',
      reasons: ['stash']
    })
  })
})
