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
      id === 'alpha'
        ? { dryRun: true, enabled: true, rows: [row] }
        : id === 'old'
          ? Promise.reject(Object.assign(new Error('x'), { code: 'method_not_found' }))
          : Promise.reject(new Error('timed out'))
    )
    const servers = await cleanUpPairedServers(
      {
        listEnvironments: () => [
          { id: 'alpha', name: 'alpha' },
          { id: 'old', name: 'old' },
          { id: 'down', name: 'down' }
        ],
        callEnvironment
      },
      { dryRun: true, bot: 'aria', includeRemote: true }
    )
    expect(callEnvironment).toHaveBeenCalledWith(
      'alpha',
      'fork.workerCleanup.run',
      { dryRun: true, bot: 'aria', includeRemote: false },
      expect.any(Number)
    )
    expect(servers).toEqual([
      { name: 'alpha', environmentId: 'alpha', ok: true, rows: [{ ...row, server: 'alpha' }] },
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
