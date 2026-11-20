// Fork (BAD-694): a worker started with --card links its new workspace to that Linear card.
import { describe, expect, it, vi } from 'vitest'
import { createWorkerWorktree } from './worker-worktree-creation'

async function createdWith(forkCard?: string) {
  const createManagedWorktree = vi.fn(async (_args: { linkedLinearIssue?: string }) => ({
    worktree: { id: 'repo-sandbox::/created', repoId: 'repo-sandbox' },
    startupTerminal: { spawned: true, handle: 'term_worker' }
  }))
  await createWorkerWorktree({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: creation calls only the methods faked here.
    runtime: {
      createManagedWorktree,
      showRepo: async () => ({ id: 'repo-sandbox', kind: 'git' }),
      listTerminals: async () => ({ terminals: [], totalCount: 0, truncated: false })
    } as never,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: creation records only worker stages.
    db: { recordWorkerStage: () => {} } as never,
    dispatchId: 'ctx_1',
    requestedWorktree: 'new-top-level',
    target: { repoSelector: 'path:/sandbox' },
    params: { name: 'ranger-hello', from: 'term_bot', ...(forkCard ? { forkCard } : {}) },
    agent: 'claude',
    withAgentTerminal: true,
    effects: []
  })
  return createManagedWorktree.mock.calls[0]?.[0]
}

describe('createWorkerWorktree with a card', () => {
  it('links the new workspace to the card, in upper case', async () => {
    expect((await createdWith('abc-693'))?.linkedLinearIssue).toBe('ABC-693')
  })

  it('links nothing without one', async () => {
    expect(await createdWith()).not.toHaveProperty('linkedLinearIssue')
  })
})
