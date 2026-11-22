// BAD-677 (FORK.md "Worktree snapshots"): `orca worktree snapshots|restore|prune` ask the host that
// owns the projects, since the snapshot refs live in its repositories.
import { defineMethod } from '../../core'
import {
  ForkWorktreeSnapshotsListParams,
  ForkWorktreeSnapshotsPruneParams,
  ForkWorktreeSnapshotsRestoreParams
} from '../../../../../shared/fork/worktree-snapshots'
import {
  listForkWorktreeSnapshots,
  pruneForkWorktreeSnapshots,
  restoreForkWorktreeSnapshot
} from '../../../../fork/worktree-snapshots/worktree-snapshot-service'

export const FORK_WORKTREE_SNAPSHOT_METHODS = [
  defineMethod({
    name: 'fork.worktreeSnapshots.list',
    permission: 'workspace',
    params: ForkWorktreeSnapshotsListParams,
    handler: async (params, { runtime }) =>
      listForkWorktreeSnapshots(runtime.requireStore(), params.repo)
  }),
  defineMethod({
    name: 'fork.worktreeSnapshots.restore',
    permission: 'workspace',
    params: ForkWorktreeSnapshotsRestoreParams,
    handler: async (params, { runtime }) =>
      restoreForkWorktreeSnapshot(runtime.requireStore(), params)
  }),
  defineMethod({
    name: 'fork.worktreeSnapshots.prune',
    permission: 'workspace',
    params: ForkWorktreeSnapshotsPruneParams,
    handler: async (params, { runtime }) =>
      pruneForkWorktreeSnapshots(runtime.requireStore(), params.repo)
  })
] as const
