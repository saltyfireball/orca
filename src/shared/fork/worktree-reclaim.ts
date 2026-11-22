// BAD-691 (FORK.md "Worktree reclaim"): remove regenerable, git-ignored paths (dependencies, build
// output, caches) from idle worktrees without removing the worktree. Settings, wire shapes and the
// idle duration parser live here; the host does the file work (`src/main/fork/worktree-reclaim/`).
// No node or electron imports: the CLI, main and the renderer all read this file.
import { z } from 'zod'
import { FORK_WORKTREE_RECLAIM_DEFAULT_PATHS, normalizeReclaimGlobs } from './worktree-reclaim-glob'

export const FORK_WORKTREE_RECLAIM_DEFAULT_IDLE_DAYS = 3
export const FORK_WORKTREE_RECLAIM_MAX_IDLE_DAYS = 3650

export type ForkWorktreeReclaimSettings = {
  /** Fork (BAD-691): let `orca workspace reclaim` and the Space action delete regenerable ignored paths; unset is off (a dry run always works). */
  forkWorktreeReclaim?: boolean
  /** Fork (BAD-691): days without activity before a workspace may be reclaimed (0 to 3650); unset is 3. */
  forkWorktreeReclaimIdleDays?: number
  /** Fork (BAD-691): git-ignored paths to remove, as names or root-relative globs; a project's orca.yaml worktree.reclaim replaces them; unset is node_modules, dist, build, caches and similar. */
  forkWorktreeReclaimPaths?: string[]
}

export type ForkWorktreeReclaimConfig = {
  enabled: boolean
  idleDays: number
  paths: string[]
}

export function readForkWorktreeReclaimSettings(settings: unknown): ForkWorktreeReclaimConfig {
  const source = typeof settings === 'object' && settings !== null ? settings : {}
  const read = (key: keyof ForkWorktreeReclaimSettings): unknown =>
    key in source ? Object.getOwnPropertyDescriptor(source, key)?.value : undefined
  const days = read('forkWorktreeReclaimIdleDays')
  const valid =
    typeof days === 'number' &&
    Number.isFinite(days) &&
    days >= 0 &&
    days <= FORK_WORKTREE_RECLAIM_MAX_IDLE_DAYS
  const paths = normalizeReclaimGlobs(read('forkWorktreeReclaimPaths'))
  return {
    enabled: read('forkWorktreeReclaim') === true,
    idleDays: valid ? days : FORK_WORKTREE_RECLAIM_DEFAULT_IDLE_DAYS,
    paths: paths.length > 0 ? paths : [...FORK_WORKTREE_RECLAIM_DEFAULT_PATHS]
  }
}

const IDLE_UNIT_DAYS: Record<string, number> = { m: 1 / 1440, h: 1 / 24, d: 1, w: 7 }

/** "3d", "12h", "90m", "2w" or a bare number of days; null when it is none of those. */
export function parseReclaimIdle(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*([mhdw]?)$/i.exec(text.trim())
  if (!match) {
    return null
  }
  const days = Number(match[1]) * IDLE_UNIT_DAYS[(match[2] || 'd').toLowerCase()]
  return days <= FORK_WORKTREE_RECLAIM_MAX_IDLE_DAYS ? days : null
}

// Plain objects with no transforms or defaults: the mobile RPC fence refuses a wider parsed shape.
export const ForkWorktreeReclaimRunParams = z.object({
  repo: z.string().trim().min(1).max(4096).optional(),
  /** One workspace: its id or its path. */
  workspace: z.string().trim().min(1).max(4096).optional(),
  idleDays: z.number().min(0).max(FORK_WORKTREE_RECLAIM_MAX_IDLE_DAYS).optional(),
  /** Delete. Unset or false lists what would go and removes nothing. */
  apply: z.boolean().optional()
})
export type ForkWorktreeReclaimRunParamsShape = z.infer<typeof ForkWorktreeReclaimRunParams>

export type ForkWorktreeReclaimSkipReason =
  | 'in-use'
  | 'not-idle'
  | 'not-tracked'
  | 'missing-folder'
  | 'main-checkout'
  | 'git-error'

export type ForkWorktreeReclaimEntry = {
  /** Worktree-relative, with `/`. */
  path: string
  bytes: number
  /** Set when the path was left alone, with why. */
  skipped?: 'symlink' | 'holds-env-file' | 'holds-git-folder' | 'outside-worktree' | 'error'
  removed?: boolean
}

export type ForkWorktreeReclaimWorktree = {
  repoId: string
  repoName: string
  worktreeId: string
  path: string
  branch: string | null
  /** Why nothing was looked at, when it was not. */
  skipReason?: ForkWorktreeReclaimSkipReason
  /** Last activity, in ms; null when the host has none. */
  lastActivityAt: number | null
  entries: ForkWorktreeReclaimEntry[]
  /** Bytes of the entries that go (apply) or would go (dry run). */
  bytes: number
}

export type ForkWorktreeReclaimResult = {
  /** The setting forkWorktreeReclaim. A dry run works either way. */
  enabled: boolean
  /** True when nothing was deleted. */
  dryRun: boolean
  idleDays: number
  worktrees: ForkWorktreeReclaimWorktree[]
  totalBytes: number
  /** Projects and problems this host could not cover, with why. */
  notes: string[]
}
