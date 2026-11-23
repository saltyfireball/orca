// BAD-767: expired snapshots are pruned on a timer, not only when another removal runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({ prune: vi.fn() }))
vi.mock('./worktree-snapshot-service', () => ({ pruneForkWorktreeSnapshots: service.prune }))

import {
  FORK_SNAPSHOT_PRUNE_FIRST_MS,
  startForkWorktreeSnapshotPrune
} from './worktree-snapshot-prune'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITEST', '')
  service.prune.mockReset()
  service.prune.mockResolvedValue({ pruned: 2 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('startForkWorktreeSnapshotPrune', () => {
  it('prunes the host projects a while after start-up and keeps pruning', async () => {
    const store = { getRepos: () => [] }
    const stop = startForkWorktreeSnapshotPrune({ requireStore: () => store })
    expect(service.prune).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(FORK_SNAPSHOT_PRUNE_FIRST_MS)
    expect(service.prune).toHaveBeenCalledTimes(1)
    expect(service.prune).toHaveBeenCalledWith(store)
    await vi.advanceTimersByTimeAsync(FORK_SNAPSHOT_PRUNE_FIRST_MS)
    expect(service.prune).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(FORK_SNAPSHOT_PRUNE_FIRST_MS * 4)
    expect(service.prune).toHaveBeenCalledTimes(2)
  })
})
