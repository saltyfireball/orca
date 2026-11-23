import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FORK_BEST_OF_FILE, ForkBestOfStore } from './best-of-store'
import { forkBestOfFacts } from './best-of-facts'

let dir: string
let clock = 1000

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fork-best-of-'))
  clock = 1000
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function newStore(): ForkBestOfStore {
  return new ForkBestOfStore(join(dir, FORK_BEST_OF_FILE), () => clock++)
}

const attempts = [
  { index: 2, agent: 'codex', host: 'alpha', dispatchId: 'd2', taskId: 't2' },
  { index: 1, agent: 'claude', host: 'here', dispatchId: 'd1', taskId: 't1' }
]

describe('ForkBestOfStore', () => {
  it('refuses a worker already in a run, or twice in one', async () => {
    const store = newStore()
    await store.record({ prompt: 'One', attempts })
    await expect(store.record({ prompt: 'Two', attempts })).rejects.toThrow(/one best-of run/)
    await expect(
      store.record({
        prompt: 'Three',
        attempts: [attempts[0], { ...attempts[1], dispatchId: 'd2' }]
      })
    ).rejects.toThrow(/one best-of run/)
  })

  it('records runs newest first, keeps the history setting and survives a reload', async () => {
    const store = newStore()
    const fresh = (tag: string) =>
      attempts.map((attempt) => ({ ...attempt, dispatchId: `${attempt.dispatchId}-${tag}` }))
    const first = await store.record({ prompt: 'First task\nmore', attempts: fresh('a') }, 2)
    await store.record({ prompt: 'Second', attempts: fresh('b') }, 2)
    await store.record({ prompt: 'Third', attempts: fresh('c') }, 2)
    expect(first.title).toBe('First task')
    expect(first.attempts.map((attempt) => attempt.index)).toEqual([1, 2])
    const reloaded = await newStore().list()
    expect(reloaded.map((run) => run.title)).toEqual(['Third', 'Second'])
    expect((await stat(join(dir, FORK_BEST_OF_FILE))).mode & 0o777).toBe(0o600)
  })

  it('records one pick with each outcome, then refuses another', async () => {
    const store = newStore()
    const run = await store.record({ prompt: 'Task', attempts })
    const settled = await store.settle({
      id: run.id.slice(0, 6),
      winner: 2,
      loserAction: 'archive',
      outcomes: [
        { index: 1, outcome: { kind: 'archived' } },
        { index: 2, outcome: { kind: 'kept' } }
      ]
    })
    expect(settled).toMatchObject({ winner: 2, loserAction: 'archive' })
    expect(settled.attempts[0].outcome).toEqual({ kind: 'archived' })
    await expect(
      store.settle({ id: run.id, winner: 1, loserAction: 'keep', outcomes: [] })
    ).rejects.toThrow(/already picked/)
    expect((await newStore().get(run.id)).winner).toBe(2)
  })

  it('forgets a run and drops malformed records on load', async () => {
    const store = newStore()
    const run = await store.record({ prompt: 'Task', attempts })
    await store.forget(run.id)
    expect(await store.list()).toEqual([])
    const text = await readFile(join(dir, FORK_BEST_OF_FILE), 'utf8')
    expect(JSON.parse(text)).toEqual({ version: 1, runs: [] })
  })
})

describe('forkBestOfFacts', () => {
  it('answers local and federated attempts from the database and the ledger', () => {
    const facts = forkBestOfFacts(
      [
        { index: 1, agent: 'claude', host: 'here', dispatchId: 'd1', taskId: 't1' },
        { index: 2, agent: 'codex', host: 'alpha', dispatchId: 'd2', taskId: 't2' },
        { index: 3, agent: 'claude', host: 'here', startError: 'refused' }
      ],
      {
        worker: (id) =>
          id === 'd1'
            ? { worktree_id: 'r::/a', state: 'succeeded', last_error: null }
            : { worktree_id: 'local-mirror', state: 'active', last_error: null },
        federated: (id) =>
          id === 'd2'
            ? { environment_id: 'env', environment_name: 'alpha', remote_worktree_id: 'r::/b' }
            : undefined,
        task: (id) =>
          id === 't1' ? { status: 'completed', result: 'Tests: pass\nChecks: fail' } : undefined,
        usageByWorkspace: () => ({
          by: 'workspace',
          days: null,
          generatedAt: 0,
          rows: [
            {
              key: 'r::/a',
              label: 'a',
              chats: 1,
              calls: 2,
              tokens: {
                inputTokens: 1,
                outputTokens: 1,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                cacheWrite1hTokens: 0
              },
              totalTokens: 2,
              costUsd: 0.5,
              subscriptionTokens: 0,
              unpricedTokens: 0,
              lastAt: 0
            }
          ],
          total: {} as never
        })
      }
    )
    expect(facts[0]).toMatchObject({
      worktreeId: 'r::/a',
      environmentId: null,
      taskStatus: 'completed',
      checks: { tests: 'pass', checks: 'fail' },
      cost: { costUsd: 0.5, totalTokens: 2 }
    })
    expect(facts[1]).toMatchObject({
      worktreeId: 'r::/b',
      environmentId: 'env',
      hostLabel: 'alpha',
      cost: null
    })
    expect(facts[2]).toMatchObject({ worktreeId: null, workerError: 'refused' })
  })
})
