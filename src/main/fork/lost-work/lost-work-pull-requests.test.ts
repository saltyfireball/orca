// SLRM-2096: reading `gh pr list` output.
import { describe, expect, it } from 'vitest'
import { lostWorkPullRequestArgs, parseLostWorkPullRequests } from './lost-work-pull-requests'

const pr = (over: Record<string, unknown>) => ({
  number: 1,
  state: 'MERGED',
  url: 'https://example.test/pull/1',
  headRefName: 'topic',
  headRefOid: 'a'.repeat(40),
  updatedAt: '2026-01-01T00:00:00Z',
  isCrossRepository: false,
  ...over
})

describe('parseLostWorkPullRequests', () => {
  it('prefers an open pull request, then the newest', () => {
    const map = parseLostWorkPullRequests(
      JSON.stringify([
        pr({ number: 1, state: 'CLOSED', updatedAt: '2026-03-01T00:00:00Z' }),
        pr({ number: 2, state: 'MERGED', updatedAt: '2026-02-01T00:00:00Z' }),
        pr({ number: 3, state: 'OPEN', updatedAt: '2026-01-01T00:00:00Z' }),
        pr({ number: 4, headRefName: 'other', updatedAt: '2026-01-01T00:00:00Z' }),
        pr({ number: 5, headRefName: 'other', state: 'CLOSED', updatedAt: '2026-02-01T00:00:00Z' })
      ])
    )
    expect(map?.get('topic')).toMatchObject({ number: 3, state: 'open' })
    expect(map?.get('other')).toMatchObject({ number: 5, state: 'closed' })
  })

  it('skips pull requests from other forks and links that are not https', () => {
    const map = parseLostWorkPullRequests(
      JSON.stringify([
        pr({ isCrossRepository: true }),
        pr({ headRefName: 'b', url: 'javascript:alert(1)' })
      ])
    )
    expect(map?.size).toBe(0)
  })

  it('returns null for output it cannot read', () => {
    expect(parseLostWorkPullRequests('not json')).toBeNull()
    expect(parseLostWorkPullRequests('{}')).toBeNull()
  })

  it('asks for every state with the limit', () => {
    expect(lostWorkPullRequestArgs(50)).toEqual(
      expect.arrayContaining(['pr', 'list', '--state', 'all', '--limit', '50'])
    )
  })
})
