// SLRM-2096 (FORK.md "Lost work"): find work that never merged or that nobody remembers, across
// every local project's worktrees, branches and stashes. The scan only reads; each action is
// asked for one item at a time.
import { z } from 'zod'

/** Each check can be switched off in Settings > Advanced. */
export const LOST_WORK_CHECKS = [
  'unmergedWorktrees',
  'finishedWorktrees',
  'untrackedWorktrees',
  'missingFolders',
  'unmergedBranches',
  'stashes',
  'pullRequests'
] as const
export type LostWorkCheck = (typeof LOST_WORK_CHECKS)[number]
export type LostWorkChecks = Record<LostWorkCheck, boolean>

export type LostWorkSettings = {
  /** Unset checks are on. */
  checks?: Partial<LostWorkChecks>
  /** Repo id -> branch the repo merges into, when the remote's HEAD is not it. */
  defaultBranches?: Record<string, string>
  /** Folder that bundles and patches are saved to; empty asks each time. */
  archiveFolder?: string
  /** How many recent commits of the default branch are searched for a squash merge. */
  squashLookback?: number
  /** How many recent pull requests per repo are read from the hosting CLI. */
  pullRequestLimit?: number
}

export const LOST_WORK_DEFAULT_SQUASH_LOOKBACK = 500
export const LOST_WORK_DEFAULT_PULL_REQUEST_LIMIT = 200
const LOOKBACK_MAX = 10_000
const PULL_REQUEST_LIMIT_MAX = 1_000

export type ResolvedLostWorkSettings = {
  checks: LostWorkChecks
  defaultBranches: Record<string, string>
  archiveFolder: string
  squashLookback: number
  pullRequestLimit: number
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? Math.min(value, max)
    : fallback
}

/** Fills every unset or malformed field with its default. */
export function resolveLostWorkSettings(
  settings: LostWorkSettings | undefined
): ResolvedLostWorkSettings {
  const checks = {} as LostWorkChecks
  for (const check of LOST_WORK_CHECKS) {
    checks[check] = settings?.checks?.[check] !== false
  }
  const defaultBranches: Record<string, string> = {}
  for (const [repoId, branch] of Object.entries(settings?.defaultBranches ?? {})) {
    if (typeof branch === 'string' && isSafeRefName(branch.trim())) {
      defaultBranches[repoId] = branch.trim()
    }
  }
  return {
    checks,
    defaultBranches,
    archiveFolder: typeof settings?.archiveFolder === 'string' ? settings.archiveFolder : '',
    squashLookback: boundedInteger(
      settings?.squashLookback,
      LOST_WORK_DEFAULT_SQUASH_LOOKBACK,
      LOOKBACK_MAX
    ),
    pullRequestLimit: boundedInteger(
      settings?.pullRequestLimit,
      LOST_WORK_DEFAULT_PULL_REQUEST_LIMIT,
      PULL_REQUEST_LIMIT_MAX
    )
  }
}

/** A ref name that cannot be read as a git option or a revision range. */
export function isSafeRefName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !name.startsWith('-') &&
    !name.includes('..') &&
    !name.includes('@{') &&
    // Space, ~ ^ : ? * [ \ and control characters are never valid in a ref.
    // eslint-disable-next-line no-control-regex
    !/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(name) &&
    !name.endsWith('.lock') &&
    !name.endsWith('/') &&
    !name.endsWith('.')
  )
}

export type LostWorkRisk = 'safe' | 'needs-look' | 'would-lose-work'
export const LOST_WORK_RISK_ORDER: readonly LostWorkRisk[] = [
  'would-lose-work',
  'needs-look',
  'safe'
]

export type LostWorkKind = 'worktree' | 'untracked-worktree' | 'missing-folder' | 'branch' | 'stash'

/** Why an item is listed; the UI and CLI word each one. */
export type LostWorkReason =
  | 'unmerged-commits'
  | 'unpushed-commits'
  | 'dirty-files'
  | 'merged'
  | 'squash-merged'
  | 'pr-merged'
  | 'pr-closed'
  | 'pr-open'
  | 'not-tracked'
  | 'folder-missing'
  | 'detached-head'
  | 'stash'
  | 'unknown-base'

export type LostWorkPullRequest = {
  number: number
  state: 'open' | 'merged' | 'closed'
  url: string
}

export type LostWorkItem = {
  /** Stable within one scan: kind, repo and path, branch or stash commit. */
  id: string
  kind: LostWorkKind
  risk: LostWorkRisk
  reasons: LostWorkReason[]
  repoId: string
  repoName: string
  /** The `repoId::path` id Orca keys a worktree by; set for every worktree kind. */
  worktreeId?: string
  path?: string
  /** Null for a detached HEAD. */
  branch?: string | null
  head?: string
  /** The ref commits are compared with, such as `origin/main`. */
  baseRef?: string
  unmergedCommits: number | null
  unpushedCommits: number | null
  dirtyFiles: number | null
  /** Milliseconds since the epoch. */
  lastCommitAt: number | null
  pullRequest?: LostWorkPullRequest
  stash?: { index: number; message: string }
}

export type LostWorkNoteCode =
  | 'remote-project'
  | 'folder-project'
  | 'no-default-branch'
  | 'git-error'
  | 'pull-requests-unavailable'

export type LostWorkNote = {
  repoId: string
  repoName: string
  code: LostWorkNoteCode
  detail?: string
}

export type LostWorkScanResult = {
  scannedAt: number
  items: LostWorkItem[]
  notes: LostWorkNote[]
}

export type LostWorkScanArgs = { scanId: string; repoIds?: string[] }

export type LostWorkAction =
  | 'push'
  | 'create-pull-request'
  | 'save-bundle'
  | 'save-patch'
  | 'delete-branch'
  | 'drop-stash'
  | 'prune-worktree'
  | 'remove-untracked-worktree'

export type LostWorkActionArgs = {
  action: LostWorkAction
  item: LostWorkItem
  /** Where save-bundle and save-patch write; required for them. */
  folder?: string
  /** A would-lose-work item is only deleted with this set, after the second confirm. */
  confirmedLoss?: boolean
}

export type LostWorkActionResult =
  | { ok: true; files?: string[]; url?: string }
  | { ok: false; error: string }

export const LOST_WORK_CHANNELS = {
  scan: 'fork:lostWork:scan',
  cancel: 'fork:lostWork:cancel',
  act: 'fork:lostWork:act'
} as const

export type ForkLostWorkApi = {
  scan: (args: LostWorkScanArgs) => Promise<LostWorkScanResult>
  cancel: (scanId: string) => Promise<boolean>
  act: (args: LostWorkActionArgs) => Promise<LostWorkActionResult>
}

/** The `fork.lostWork.scan` runtime RPC, used by `orca lost-work`. */
export const ForkLostWorkScanParams = z.object({
  repo: z.string().min(1).max(512).optional()
})
export type ForkLostWorkScanParams = z.infer<typeof ForkLostWorkScanParams>
