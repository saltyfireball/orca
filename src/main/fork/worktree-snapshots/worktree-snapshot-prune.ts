// BAD-767 (FORK.md "Worktree snapshots"): snapshots older than the retention are pruned on a timer
// as well as when another snapshot is taken, so a host that stops removing worktrees does not
// keep its last snapshots (and the commits they hold) forever. Keep electron out of this file.
import type { Repo } from '../../../shared/repository/repo-types'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { pruneForkWorktreeSnapshots } from './worktree-snapshot-service'

export const FORK_SNAPSHOT_PRUNE_FIRST_MS = 10 * 60_000
export const FORK_SNAPSHOT_PRUNE_MAX_MS = 6 * 60 * 60_000

export type ForkSnapshotPruneRuntime = {
  requireStore: () => { getRepos: () => Repo[] }
}

/** The first pass comes 10 minutes after start-up; without work the wait doubles up to 6 hours. */
export function startForkWorktreeSnapshotPrune(runtime: ForkSnapshotPruneRuntime): () => void {
  if (process.env.VITEST) {
    return () => undefined
  }
  return startForkBackoffTimer({
    run: async () => (await pruneForkWorktreeSnapshots(runtime.requireStore())).pruned > 0,
    baseMs: FORK_SNAPSHOT_PRUNE_FIRST_MS,
    maxMs: FORK_SNAPSHOT_PRUNE_MAX_MS,
    onError: (error) => console.warn('[fork-worktree-snapshots] prune pass failed', error)
  })
}
