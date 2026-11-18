// Keep main current (SLRM-2384, FORK.md): each host fetches its local projects' default branch on a
// timer and fast-forwards the branch when that is safe, so new worktrees on a headless server start
// from current main. Off by default. Settings, their checks, and the fork.mainSync.* wire contract,
// shared by main, the CLI and the Settings card.
import { z } from 'zod'

export type ForkMainSyncSettings = {
  /** Fork (SLRM-2384): fetch each local project's default branch on a timer and fast-forward it when it is clean and behind; off unless true. */
  forkMainSync?: boolean
  /** Fork main sync: minutes between two passes (5 to 1440); unset is 15. */
  forkMainSyncMinutes?: number
  /** Fork main sync: projects it keeps current, by name, id or path; unset or empty is every local git project. */
  forkMainSyncProjects?: string[]
  /** Fork main sync: leave a default branch alone while its checkout has live terminals or a working agent; unset is on. */
  forkMainSyncSkipInUse?: boolean
}

export const FORK_MAIN_SYNC_DEFAULT_MINUTES = 15
export const FORK_MAIN_SYNC_MIN_MINUTES = 5
export const FORK_MAIN_SYNC_MAX_MINUTES = 1440
export const FORK_MAIN_SYNC_MINUTE_CHOICES: readonly number[] = [5, 15, 30, 60, 240, 1440]
/** Most project entries used; the rest are ignored. */
const MAX_PROJECTS = 200
const MAX_PROJECT_CHARS = 1000

export type ForkMainSyncConfig = {
  enabled: boolean
  intervalMs: number
  /** Names, ids or paths; empty is every local git project. */
  projects: string[]
  skipInUse: boolean
}

/** Any settings object; every value is checked here, so a hand-edited file cannot break a reader. */
export type ForkMainSyncSettingsSource =
  | Partial<Record<keyof ForkMainSyncSettings, unknown>>
  | null
  | undefined

export function readForkMainSyncConfig(settings: ForkMainSyncSettingsSource): ForkMainSyncConfig {
  const minutes = settings?.forkMainSyncMinutes
  const validMinutes =
    typeof minutes === 'number' &&
    Number.isInteger(minutes) &&
    minutes >= FORK_MAIN_SYNC_MIN_MINUTES &&
    minutes <= FORK_MAIN_SYNC_MAX_MINUTES
  const rawProjects = Array.isArray(settings?.forkMainSyncProjects)
    ? settings.forkMainSyncProjects
    : []
  const projects = rawProjects
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= MAX_PROJECT_CHARS)
    .slice(0, MAX_PROJECTS)
  return {
    enabled: settings?.forkMainSync === true,
    intervalMs: (validMinutes ? minutes : FORK_MAIN_SYNC_DEFAULT_MINUTES) * 60_000,
    projects,
    skipInUse: settings?.forkMainSyncSkipInUse !== false
  }
}

/** True when the project list is empty or names this project by id, name or path. */
export function forkMainSyncWantsProject(
  projects: readonly string[],
  project: { id: string; name: string; path: string }
): boolean {
  return (
    projects.length === 0 ||
    projects.some(
      (entry) => entry === project.id || entry === project.name || entry === project.path
    )
  )
}

/** What one pass did to one project. */
export type ForkMainSyncOutcome = 'updated' | 'current' | 'skipped' | 'failed'

/**
 * Why: `fast-forwarded` (the checked-out branch moved), `ref-moved` (the branch, checked out
 * nowhere, moved), `up-to-date`, `fetched-only` (no local branch to move), `ahead` (local has
 * commits the remote lacks, nothing to take), `diverged`, `dirty`, `operation` (a merge, rebase,
 * cherry-pick, revert or bisect is under way, or git holds its index lock), `checked-out-elsewhere`
 * (a linked worktree has the branch), `in-use` (its checkout has live terminals or a working
 * agent), `no-default-branch`, `no-remote`, `no-remote-branch`, `missing-folder`, `fetch-failed`,
 * `update-failed`.
 */
export type ForkMainSyncReason =
  | 'fast-forwarded'
  | 'ref-moved'
  | 'up-to-date'
  | 'fetched-only'
  | 'ahead'
  | 'diverged'
  | 'dirty'
  | 'operation'
  | 'checked-out-elsewhere'
  | 'in-use'
  | 'no-default-branch'
  | 'no-remote'
  | 'no-remote-branch'
  | 'missing-folder'
  | 'fetch-failed'
  | 'update-failed'

export type ForkMainSyncRepoResult = {
  repoId: string
  name: string
  /** The local default branch, when one was found. */
  branch: string | null
  /** `origin/main` style, when a remote copy was found. */
  remoteRef: string | null
  outcome: ForkMainSyncOutcome
  reason: ForkMainSyncReason
  /** Short commit ids before and after, when the branch moved. */
  from?: string
  to?: string
  /** One line of git's own error, at most 300 characters, when a git step failed. */
  detail?: string
  at: number
}

export type ForkMainSyncStatus = {
  enabled: boolean
  intervalMinutes: number
  projects: string[]
  skipInUse: boolean
  running: boolean
  lastRunAt: number | null
  nextRunAt: number | null
  results: ForkMainSyncRepoResult[]
}

export const FORK_MAIN_SYNC_STATUS_METHOD = 'fork.mainSync.status'
export const FORK_MAIN_SYNC_RUN_METHOD = 'fork.mainSync.run'

export const ForkMainSyncStatusParams = z.object({})

export const ForkMainSyncRunParams = z.object({
  /** One project by name, id or path; unset is every project the settings name. */
  repo: z.string().min(1).max(MAX_PROJECT_CHARS).optional()
})
