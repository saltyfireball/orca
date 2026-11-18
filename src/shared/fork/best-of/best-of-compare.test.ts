import { describe, expect, it, vi } from 'vitest'
import { readForkBestOfDiff, settleForkBestOf, type ForkBestOfCall } from './best-of-compare'
import type { ForkBestOfAttemptFacts, ForkBestOfShowResult } from './best-of-wire'

function facts(index: number, over: Partial<ForkBestOfAttemptFacts> = {}): ForkBestOfAttemptFacts {
  return {
    index,
    worktreeId: `repo::/wt/${index}`,
    environmentId: null,
    hostLabel: null,
    workerState: 'succeeded',
    workerError: null,
    taskStatus: 'completed',
    report: null,
    checks: { tests: 'unknown', checks: 'unknown' },
    cost: null,
    ...over
  }
}

const READY = {
  summary: { baseRef: 'origin/main', baseOid: 'a', compareRef: 'b', headOid: 'c', status: 'ready' },
  entries: [
    { path: 'a.ts', status: 'modified', added: 3, removed: 1 },
    { path: 'b.ts', status: 'added', added: 10 }
  ]
}

describe('readForkBestOfDiff', () => {
  it('compares the worktree against its create base on its own host', async () => {
    const call = vi.fn<ForkBestOfCall>(async (_env, method) => {
      if (method === 'worktree.show') {
        return { worktree: { baseRef: 'origin/main' } }
      }
      if (method === 'git.branchCompare') {
        return READY
      }
      return { entries: [{}, {}] }
    })
    const result = await readForkBestOfDiff(call, facts(1, { environmentId: 'env-1' }), {})
    expect(result).toMatchObject({
      diff: { baseRef: 'origin/main', files: 2, added: 13, removed: 1, uncommitted: 2 }
    })
    expect(call.mock.calls.map(([env, method]) => [env, method])).toEqual([
      ['env-1', 'worktree.show'],
      ['env-1', 'git.branchCompare'],
      ['env-1', 'git.status']
    ])
    expect(call.mock.calls[1][2]).toEqual({ worktree: 'id:repo::/wt/1', baseRef: 'origin/main' })
  })

  it('falls back to the run base, reports errors and waits for a worktree', async () => {
    const call = vi.fn<ForkBestOfCall>(async (_env, method, params) => {
      if (method === 'worktree.show') {
        throw new Error('old host')
      }
      if (method === 'git.branchCompare') {
        expect(params.baseRef).toBe('develop')
        throw new Error('no such ref')
      }
      return {}
    })
    expect(await readForkBestOfDiff(call, facts(1), { baseBranch: 'develop' })).toEqual({
      error: 'no such ref'
    })
    expect(await readForkBestOfDiff(call, facts(2, { worktreeId: null }), {})).toEqual({
      pending: true
    })
  })
})

function shown(over: Partial<ForkBestOfShowResult['run']> = {}): ForkBestOfShowResult {
  return {
    run: {
      id: 'abcdef123456',
      createdAt: 1,
      title: 't',
      prompt: 'p',
      attempts: [1, 2, 3].map((index) => ({ index, agent: 'claude', host: 'here' })),
      ...over
    },
    facts: [facts(1), facts(2, { environmentId: 'env-2' }), facts(3, { worktreeId: null })]
  }
}

describe('settleForkBestOf', () => {
  it('keeps the winner, archives the others on their hosts and records the pick', async () => {
    const call = vi.fn<ForkBestOfCall>(async (_env, method, params) => {
      if (method === 'worktree.archive' && params.worktree === 'id:repo::/wt/2') {
        throw new Error('uncommitted changes')
      }
      return {}
    })
    const result = await settleForkBestOf({
      call,
      shown: shown(),
      winner: 1,
      loserAction: 'archive'
    })
    expect(result.outcomes).toEqual([
      { index: 1, outcome: { kind: 'kept' } },
      { index: 2, outcome: { kind: 'failed', message: 'uncommitted changes' } },
      { index: 3, outcome: { kind: 'left', message: 'It has no worktree.' } }
    ])
    expect(call).toHaveBeenCalledWith('env-2', 'worktree.archive', { worktree: 'id:repo::/wt/2' })
    expect(call).toHaveBeenLastCalledWith(null, 'fork.bestOf.settle', {
      id: 'abcdef123456',
      winner: 1,
      loserAction: 'archive',
      outcomes: result.outcomes
    })
  })

  it('removes without force or branch delete, and leaves on keep', async () => {
    const call = vi.fn<ForkBestOfCall>(async () => ({}))
    await settleForkBestOf({ call, shown: shown(), winner: 2, loserAction: 'remove' })
    expect(call).toHaveBeenCalledWith(null, 'worktree.rm', {
      worktree: 'id:repo::/wt/1',
      deleteBranch: false
    })
    call.mockClear()
    await settleForkBestOf({ call, shown: shown(), winner: 2, loserAction: 'keep' })
    expect(call.mock.calls.map(([, method]) => method)).toEqual(['fork.bestOf.settle'])
  })

  it('refuses an unknown winner and a second pick before touching anything', async () => {
    const call = vi.fn<ForkBestOfCall>(async () => ({}))
    await expect(
      settleForkBestOf({ call, shown: shown(), winner: 4, loserAction: 'archive' })
    ).rejects.toThrow(/not in this run/)
    await expect(
      settleForkBestOf({ call, shown: shown({ winner: 1 }), winner: 2, loserAction: 'archive' })
    ).rejects.toThrow(/already picked/)
    expect(call).not.toHaveBeenCalled()
  })
})
