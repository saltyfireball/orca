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
  /** Seconds the pull request read may take per repository before the scan goes on without it. */
  pullRequestTimeoutSeconds?: number
  /** Repositories scanned at once; 0 picks a number from the machine's cores. */
  projectConcurrency?: number
  /** Branches and worktrees read at once inside one repository; 0 picks from the cores. */
  itemConcurrency?: number
}

export const LOST_WORK_DEFAULT_SQUASH_LOOKBACK = 500
export const LOST_WORK_DEFAULT_PULL_REQUEST_LIMIT = 200
export const LOST_WORK_DEFAULT_PULL_REQUEST_TIMEOUT_SECONDS = 20
/** 0 in either concurrency setting: derive it from the cores (`resolveLostWorkConcurrency`). */
export const LOST_WORK_AUTO_CONCURRENCY = 0
const LOOKBACK_MAX = 10_000
const PULL_REQUEST_LIMIT_MAX = 1_000
const PULL_REQUEST_TIMEOUT_MAX_SECONDS = 600
const PROJECT_CONCURRENCY_MAX = 16
const ITEM_CONCURRENCY_MAX = 32

export type ResolvedLostWorkSettings = {
  checks: LostWorkChecks
  defaultBranches: Record<string, string>
  archiveFolder: string
  squashLookback: number
  pullRequestLimit: number
  pullRequestTimeoutSeconds: number
  projectConcurrency: number
  itemConcurrency: number
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
    ),
    // A limit of 0 would drop every pull request read, which the check's own switch is for.
    pullRequestTimeoutSeconds:
      boundedInteger(settings?.pullRequestTimeoutSeconds, 0, PULL_REQUEST_TIMEOUT_MAX_SECONDS) ||
      LOST_WORK_DEFAULT_PULL_REQUEST_TIMEOUT_SECONDS,
    projectConcurrency: boundedInteger(
      settings?.projectConcurrency,
      LOST_WORK_AUTO_CONCURRENCY,
      PROJECT_CONCURRENCY_MAX
    ),
    itemConcurrency: boundedInteger(
      settings?.itemConcurrency,
      LOST_WORK_AUTO_CONCURRENCY,
      ITEM_CONCURRENCY_MAX
    )
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/**
 * How many repositories, and how many branches or worktrees inside each, the scan reads at once.
 * Automatic leaves most cores free: git processes are short but each loads the repository, and
 * Orca's own git admission lets only a few run at a time anyway.
 */
export function resolveLostWorkConcurrency(
  settings: Pick<ResolvedLostWorkSettings, 'projectConcurrency' | 'itemConcurrency'>,
  parallelism: number
): { projects: number; items: number } {
  const cores = Number.isFinite(parallelism) && parallelism >= 1 ? parallelism : 1
  return {
    projects: settings.projectConcurrency || clamp(cores / 4, 2, 4),
    items: settings.itemConcurrency || clamp(cores / 2, 2, 6)
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
  /** Scanned together with another project of the same repository; `detail` names it. */
  | 'shared-repository'

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

/** Sent while a scan runs: how far it is, and what the projects that just finished hold. */
export type LostWorkScanProgress = {
  /** Projects finished, of `total`. */
  done: number
  total: number
  /** Names of the projects being read now. */
  current: string[]
  /** Set when a repository finishes: its projects and everything found in them. */
  finished?: { repoIds: string[]; items: LostWorkItem[]; notes: LostWorkNote[] }
}

export type LostWorkScanProgressEvent = LostWorkScanProgress & { scanId: string }

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
  act: 'fork:lostWork:act',
  progress: 'fork:lostWork:progress'
} as const

export type ForkLostWorkApi = {
  scan: (args: LostWorkScanArgs) => Promise<LostWorkScanResult>
  cancel: (scanId: string) => Promise<boolean>
  /** Calls back as a running scan moves on; returns the unsubscribe. */
  onScanProgress: (callback: (event: LostWorkScanProgressEvent) => void) => () => void
  act: (args: LostWorkActionArgs) => Promise<LostWorkActionResult>
}

/** The `fork.lostWork.scan` runtime RPC, used by `orca lost-work`. */
export const ForkLostWorkScanParams = z.object({
  repo: z.string().min(1).max(512).optional()
})
export type ForkLostWorkScanParams = z.infer<typeof ForkLostWorkScanParams>
