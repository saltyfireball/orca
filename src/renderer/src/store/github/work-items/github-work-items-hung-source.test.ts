import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore, mockApi, resetRemoteRuntimeMocks } from '../github-slice-test-harness'
import type { Repo } from '../../../../../shared/repository/repo-types'

const repos: Repo[] = ['a', 'b', 'hung'].map((name, index) => ({
  id: `repo-${name}`,
  path: `/work/${name}`,
  displayName: name,
  badgeColor: '#000',
  addedAt: index
}))

function envelope(number: number) {
  return {
    items: [
      {
        id: `pr-${number}`,
        type: 'pr' as const,
        number,
        title: `PR ${number}`,
        state: 'open' as const,
        url: `https://github.com/o/r/pull/${number}`,
        labels: [],
        updatedAt: '2026-11-01T00:00:00Z',
        author: 'octo'
      }
    ],
    sources: { issues: null, prs: null, originCandidate: null, upstreamCandidate: null }
  }
}

describe('work items when one project never answers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetRemoteRuntimeMocks()
    mockApi.gh.listWorkItems.mockImplementation(({ repoId }: { repoId: string }) =>
      repoId === 'repo-hung'
        ? new Promise(() => {})
        : Promise.resolve(envelope(repoId === 'repo-a' ? 1 : 2))
    )
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fills with the projects that loaded and names the one that timed out', async () => {
    const store = createTestStore()
    store.setState({ repos })
    const pending = store.getState().fetchWorkItemsAcrossRepos(
      repos.map((repo) => ({ repoId: repo.id, path: repo.path })),
      24,
      24,
      ''
    )
    await vi.advanceTimersByTimeAsync(61_000)
    const result = await pending

    expect(result?.items.map((item) => item.repoId).sort()).toEqual(['repo-a', 'repo-b'])
    expect(result?.failedCount).toBe(1)
    expect(result?.failedSources).toEqual([
      {
        repoId: 'repo-hung',
        reason: 'timeout',
        message: 'No answer from GitHub after 40 seconds.'
      }
    ])
  })

  it('does not let hung projects hold every request slot', async () => {
    const hungRepos: Repo[] = Array.from({ length: 10 }, (_, index) => ({
      id: `repo-hung-${index}`,
      path: `/work/hung-${index}`,
      displayName: `hung-${index}`,
      badgeColor: '#000',
      addedAt: index
    }))
    mockApi.gh.listWorkItems.mockImplementation(({ repoId }: { repoId: string }) =>
      repoId.startsWith('repo-hung') ? new Promise(() => {}) : Promise.resolve(envelope(1))
    )
    const store = createTestStore()
    store.setState({ repos: [...hungRepos, repos[0]] })
    const pending = store.getState().fetchWorkItemsAcrossRepos(
      [...hungRepos, repos[0]].map((repo) => ({ repoId: repo.id, path: repo.path })),
      24,
      24,
      ''
    )
    await vi.advanceTimersByTimeAsync(130_000)
    const result = await pending

    expect(result?.items.map((item) => item.repoId)).toEqual(['repo-a'])
    expect(result?.failedSources).toHaveLength(10)
  })
})
