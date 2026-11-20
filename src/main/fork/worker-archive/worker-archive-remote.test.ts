// Paired servers' part of a cleanup: each server's own answer, a silent server and an old build.
import { describe, expect, it, vi } from 'vitest'
import type { ForkWorkerCleanupRow } from '../../../shared/fork/worker-archive'
import { cleanUpPairedServers } from './worker-archive-remote'

const row: ForkWorkerCleanupRow = {
  worktreeId: 'repo::/s/a',
  name: 'heron',
  branch: 'b',
  path: '/s/a',
  botName: null,
  finishedAtMs: 1,
  outcome: 'remove',
  canForce: false
}

describe('cleanUpPairedServers', () => {
  it('asks every server for its own pass, without asking it to ask others', async () => {
    const callEnvironment = vi.fn(async (id: string) =>
      id === 'kif'
        ? { dryRun: true, enabled: true, rows: [row] }
        : id === 'old'
          ? Promise.reject(Object.assign(new Error('x'), { code: 'method_not_found' }))
          : Promise.reject(new Error('timed out'))
    )
    const servers = await cleanUpPairedServers(
      {
        listEnvironments: () => [
          { id: 'kif', name: 'kif' },
          { id: 'old', name: 'old' },
          { id: 'down', name: 'down' }
        ],
        callEnvironment
      },
      { dryRun: true, bot: 'cassandra', includeRemote: true }
    )
    expect(callEnvironment).toHaveBeenCalledWith(
      'kif',
      'fork.workerCleanup.run',
      { dryRun: true, bot: 'cassandra', includeRemote: false },
      expect.any(Number)
    )
    expect(servers).toEqual([
      { name: 'kif', environmentId: 'kif', ok: true, rows: [{ ...row, server: 'kif' }] },
      {
        name: 'old',
        environmentId: 'old',
        ok: false,
        error: 'This server has no worker cleanup. Update it and try again.',
        rows: []
      },
      { name: 'down', environmentId: 'down', ok: false, error: 'timed out', rows: [] }
    ])
  })

  it('lists a server whose answer is not a cleanup result as unreadable', async () => {
    const servers = await cleanUpPairedServers(
      {
        listEnvironments: () => [{ id: 'a', name: 'a' }],
        callEnvironment: async () => ({ nope: 1 })
      },
      {}
    )
    expect(servers).toEqual([
      { name: 'a', environmentId: 'a', ok: false, error: 'unreadable answer', rows: [] }
    ])
  })
})
