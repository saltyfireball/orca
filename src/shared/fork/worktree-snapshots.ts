// BAD-677 (FORK.md "Worktree snapshots"): before Orca removes a worktree that holds uncommitted,
// untracked or unpushed work, it writes a snapshot commit under a private ref. Settings, names and
// the wire shapes live here; the host does the git work (`src/main/fork/worktree-snapshots/`).
// No node or electron imports: the CLI and main both read this file.
import { z } from 'zod'

export const FORK_WORKTREE_SNAPSHOT_REF_PREFIX = 'refs/orca/snapshots/'
export const FORK_WORKTREE_SNAPSHOT_DEFAULT_RETENTION_DAYS = 14
export const FORK_WORKTREE_SNAPSHOT_MAX_RETENTION_DAYS = 365

export type ForkWorktreeSnapshotSettings = {
  /** Fork (BAD-677): snapshot a worktree's uncommitted, untracked and unpushed work before Orca removes it; unset is on. */
  forkWorktreeSnapshots?: boolean
  /** Fork (BAD-677): days a snapshot is kept before it is pruned (1 to 365); unset is 14. */
  forkWorktreeSnapshotRetentionDays?: number
}

export type ForkWorktreeSnapshotConfig = { enabled: boolean; retentionDays: number }

export function readForkWorktreeSnapshotSettings(settings: unknown): ForkWorktreeSnapshotConfig {
  const source = typeof settings === 'object' && settings !== null ? settings : {}
  const read = (key: keyof ForkWorktreeSnapshotSettings): unknown =>
    key in source ? Object.getOwnPropertyDescriptor(source, key)?.value : undefined
  const days = read('forkWorktreeSnapshotRetentionDays')
  const valid =
    typeof days === 'number' &&
    Number.isInteger(days) &&
    days >= 1 &&
    days <= FORK_WORKTREE_SNAPSHOT_MAX_RETENTION_DAYS
  return {
    enabled: read('forkWorktreeSnapshots') !== false,
    retentionDays: valid ? days : FORK_WORKTREE_SNAPSHOT_DEFAULT_RETENTION_DAYS
  }
}

/** One snapshot. `id` is `<workspace>/<ms timestamp>`, the ref's name under the prefix. */
export type ForkWorktreeSnapshot = {
  id: string
  repoId: string
  repoName: string
  workspace: string
  /** Where the worktree was. */
  path: string
  /** The branch it had checked out; null when detached. */
  branch: string | null
  /** The commit HEAD pointed at; null for a repository with no commit yet. */
  head: string | null
  /** The snapshot commit (working tree, parent is `head`). */
  commit: string
  createdAt: number
  expiresAt: number
  /** Changed, staged and untracked files the snapshot holds, when counted. */
  files: number
}

// Plain objects with no transforms or defaults: the mobile RPC fence refuses a wider parsed shape.
export const ForkWorktreeSnapshotsListParams = z.object({
  repo: z.string().trim().min(1).max(4096).optional()
})
export const ForkWorktreeSnapshotsRestoreParams = z.object({
  id: z.string().trim().min(1).max(512),
  repo: z.string().trim().min(1).max(4096).optional(),
  /** Restore here instead of the original path. */
  path: z.string().trim().min(1).max(4096).optional()
})
export const ForkWorktreeSnapshotsPruneParams = z.object({
  repo: z.string().trim().min(1).max(4096).optional()
})

export type ForkWorktreeSnapshotsListResult = {
  enabled: boolean
  retentionDays: number
  snapshots: ForkWorktreeSnapshot[]
  /** Projects this host could not read, with why. */
  notes: string[]
}
export type ForkWorktreeSnapshotsRestoreResult = {
  snapshot: ForkWorktreeSnapshot
  path: string
  /** The branch checked out in the restored worktree; null when detached. */
  branch: string | null
  note: string | null
}
export type ForkWorktreeSnapshotsPruneResult = { pruned: number }
