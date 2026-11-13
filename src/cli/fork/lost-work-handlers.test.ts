// SLRM-2096: the `orca lost-work` table.
import { describe, expect, it } from 'vitest'
import type { LostWorkItem } from '../../shared/fork/lost-work'
import { formatLostWork, sortLostWork } from './lost-work-handlers'

function item(over: Partial<LostWorkItem>): LostWorkItem {
  return {
    id: over.id ?? 'x',
    kind: 'worktree',
    risk: 'safe',
    reasons: [],
    repoId: 'r',
    repoName: 'alpha',
    unmergedCommits: 0,
    unpushedCommits: 0,
    dirtyFiles: 0,
    lastCommitAt: null,
    ...over
  }
}

describe('formatLostWork', () => {
  it('says when nothing was found and still prints notes', () => {
    const text = formatLostWork({
      scannedAt: 0,
      items: [],
      notes: [{ repoId: 'r', repoName: 'alpha', code: 'remote-project' }]
    })
    expect(text).toBe('No lost work found.\nNote: alpha: skipped: runs on another host')
  })

  it('puts riskiest first and shows counts, PR and place', () => {
    const text = formatLostWork({
      scannedAt: 0,
      items: [
        item({ id: 'a', branch: 'done', path: '/w/done' }),
        item({
          id: 'b',
          risk: 'would-lose-work',
          branch: 'feat',
          path: '/w/feat',
          unmergedCommits: 3,
          unpushedCommits: 2,
          dirtyFiles: null,
          lastCommitAt: Date.UTC(2026, 0, 2),
          pullRequest: { number: 7, state: 'open', url: 'https://example.test/7' }
        }),
        item({
          id: 'c',
          kind: 'stash',
          risk: 'would-lose-work',
          stash: { index: 0, message: 'wip' }
        })
      ],
      notes: []
    })
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^RISK\s+KIND\s+PROJECT\s+COMMITS\s+DIRTY\s+LAST COMMIT\s+PR\s+BRANCH/)
    expect(lines[1]).toContain('would lose work')
    expect(lines[1]).toContain('3 (2 unpushed)')
    expect(lines[1]).toContain('2026-01-02')
    expect(lines[1]).toContain('#7 open')
    expect(lines[1]).toContain('feat  /w/feat')
    expect(lines.some((line) => line.includes('stash@{0} wip'))).toBe(true)
    expect(lines[3]).toContain('safe to remove')
  })

  it('sorts by risk, then project, then newest commit', () => {
    const sorted = sortLostWork([
      item({ id: '1', repoName: 'b' }),
      item({ id: '2', repoName: 'a', lastCommitAt: 1 }),
      item({ id: '3', repoName: 'a', lastCommitAt: 2 }),
      item({ id: '4', risk: 'needs-look', repoName: 'z' })
    ])
    expect(sorted.map((entry) => entry.id)).toEqual(['4', '3', '2', '1'])
  })
})
