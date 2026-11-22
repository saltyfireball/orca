// BAD-678 (FORK.md "Turn checkpoints"): Orca snapshots a workspace's files into a shadow git store
// at the end of each agent turn, so one bad turn can be diffed and rolled back for every agent,
// terminal or chat. Settings, names and the wire shapes live here; the host does the git work
// (`src/main/fork/turn-checkpoints/`). No node or electron imports: the CLI and main both read it.
import { z } from 'zod'

export const FORK_TURN_CHECKPOINT_REF_PREFIX = 'refs/orca/checkpoints/'

export const FORK_TURN_CHECKPOINT_DEFAULTS = {
  maxFileMb: 5,
  keep: 50,
  retentionDays: 7
} as const
export const FORK_TURN_CHECKPOINT_LIMITS = {
  maxFileMb: { min: 1, max: 1024 },
  keep: { min: 2, max: 1000 },
  retentionDays: { min: 1, max: 365 }
} as const

export type ForkTurnCheckpointSettings = {
  /** Fork (BAD-678): checkpoint a workspace's files at the end of each agent turn; unset is on. */
  forkTurnCheckpoints?: boolean
  /** Fork (BAD-678): files larger than this many MB are left out of checkpoints (1 to 1024); unset is 5. */
  forkTurnCheckpointMaxFileMb?: number
  /** Fork (BAD-678): checkpoints kept per workspace, newest first (2 to 1000); unset is 50. */
  forkTurnCheckpointKeep?: number
  /** Fork (BAD-678): days a checkpoint is kept (1 to 365); unset is 7. */
  forkTurnCheckpointRetentionDays?: number
}

export type ForkTurnCheckpointConfig = {
  enabled: boolean
  maxFileMb: number
  keep: number
  retentionDays: number
}

function readBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

export function readForkTurnCheckpointSettings(settings: unknown): ForkTurnCheckpointConfig {
  const source = typeof settings === 'object' && settings !== null ? settings : {}
  const read = (key: keyof ForkTurnCheckpointSettings): unknown =>
    key in source ? Object.getOwnPropertyDescriptor(source, key)?.value : undefined
  const limits = FORK_TURN_CHECKPOINT_LIMITS
  const defaults = FORK_TURN_CHECKPOINT_DEFAULTS
  return {
    enabled: read('forkTurnCheckpoints') !== false,
    maxFileMb: readBoundedInt(
      read('forkTurnCheckpointMaxFileMb'),
      defaults.maxFileMb,
      limits.maxFileMb.min,
      limits.maxFileMb.max
    ),
    keep: readBoundedInt(
      read('forkTurnCheckpointKeep'),
      defaults.keep,
      limits.keep.min,
      limits.keep.max
    ),
    retentionDays: readBoundedInt(
      read('forkTurnCheckpointRetentionDays'),
      defaults.retentionDays,
      limits.retentionDays.min,
      limits.retentionDays.max
    )
  }
}

export type ForkTurnCheckpointKind = 'baseline' | 'turn' | 'pre-restore' | 'restore'

/** One checkpoint. `id` is the ref's name under the prefix (a millisecond timestamp). */
export type ForkTurnCheckpoint = {
  id: string
  kind: ForkTurnCheckpointKind
  createdAt: number
  /** Files that differ from the checkpoint before it. */
  files: number
  /** The agent chat or terminal session that ended the turn, when known. */
  sessionId: string | null
  agent: string | null
  /** The start of the prompt the turn answered, when known. */
  prompt: string | null
  /** For a restore: the checkpoint it restored. */
  restoredFrom: string | null
  /** For a restore: the checkpoint holding the state from before it (what `undo` returns to). */
  undoTo: string | null
}

export type ForkTurnCheckpointFile = {
  path: string
  /** A added, M modified, D deleted, T type changed. */
  status: 'A' | 'M' | 'D' | 'T'
}

// Plain objects with no transforms or defaults: the mobile RPC fence refuses a wider parsed shape.
const worktreeParam = z.string().trim().min(1).max(4096)
export const ForkTurnCheckpointsListParams = z.object({ worktree: worktreeParam })
export const ForkTurnCheckpointsDiffParams = z.object({
  worktree: worktreeParam,
  id: z.string().trim().min(1).max(128),
  /** Diff the checkpoint against the files as they are now instead of against the checkpoint before it. */
  now: z.boolean().optional(),
  /** Include the patch text, not only the file list. */
  patch: z.boolean().optional()
})
export const ForkTurnCheckpointsRestoreParams = z.object({
  worktree: worktreeParam,
  id: z.string().trim().min(1).max(128),
  /** Restore although another agent looks busy in the same directory. */
  force: z.boolean().optional()
})
export const ForkTurnCheckpointsUndoParams = z.object({
  worktree: worktreeParam,
  force: z.boolean().optional()
})

export type ForkTurnCheckpointsListResult = {
  enabled: boolean
  path: string
  retentionDays: number
  keep: number
  checkpoints: ForkTurnCheckpoint[]
}
export type ForkTurnCheckpointsDiffResult = {
  checkpoint: ForkTurnCheckpoint
  against: 'previous' | 'now'
  files: ForkTurnCheckpointFile[]
  /** Files left out because the turn only pulled them in (a merge, pull or checkout). */
  excludedMergedFiles: number
  patch: string | null
  patchTruncated: boolean
}
export type ForkTurnCheckpointsRestoreResult = {
  restoredTo: ForkTurnCheckpoint
  /** The checkpoint holding the files from before the restore; null when nothing differed. */
  preRestore: ForkTurnCheckpoint | null
  /** The checkpoint recording the restored state; null when nothing changed. */
  restore: ForkTurnCheckpoint | null
  changedFiles: number
  note: string | null
}

/** True when the agent state says it is still doing something in the workspace. */
export function forkTurnCheckpointAgentBusy(state: string | undefined): boolean {
  return state === 'working' || state === 'blocked'
}
