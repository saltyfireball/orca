// Worker workspace archive (FORK.md, BAD-669): a finished orchestration worker that was started in
// a workspace of its own (`worktree: new-child` or `new-top-level`) keeps that workspace, its
// terminals and its build output until someone removes it. This module holds the settings, the
// wire types and the one decision that says what happens to such a workspace. It has no git, no
// database and no Electron, so every rule is tested with plain facts.
import { z } from 'zod'
import type { ForkGlobalSettings } from './fork-global-settings'

export const FORK_WORKER_ARCHIVE_DEFAULT_DELAY_MINUTES = 120
export const FORK_WORKER_TERMINAL_STOP_DEFAULT_MINUTES = 15
/** A month; a hand-edited value past it falls back to the default. */
const MAX_DELAY_MINUTES = 30 * 24 * 60
/** The delay choices the settings menu offers. */
export const FORK_WORKER_ARCHIVE_DELAY_CHOICES: readonly number[] = [
  15, 30, 60, 120, 240, 720, 1440, 4320
]
export const FORK_WORKER_TERMINAL_STOP_CHOICES: readonly number[] = [1, 5, 15, 30, 60, 120]
/** An activity stamp this close after the report is the report itself, not someone using the worker. */
export const FORK_WORKER_ARCHIVE_REPORT_SLACK_MS = 5_000

type WorkerArchiveSettings = Pick<
  ForkGlobalSettings,
  'forkWorkerArchive' | 'forkWorkerArchiveDelayMinutes' | 'forkWorkerTerminalStopMinutes'
>

function readSettings(value: unknown): WorkerArchiveSettings {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const enabled = 'forkWorkerArchive' in value ? value.forkWorkerArchive : undefined
  const delay =
    'forkWorkerArchiveDelayMinutes' in value ? value.forkWorkerArchiveDelayMinutes : undefined
  const stop =
    'forkWorkerTerminalStopMinutes' in value ? value.forkWorkerTerminalStopMinutes : undefined
  return {
    ...(typeof enabled === 'boolean' ? { forkWorkerArchive: enabled } : {}),
    ...(typeof delay === 'number' ? { forkWorkerArchiveDelayMinutes: delay } : {}),
    ...(typeof stop === 'number' ? { forkWorkerTerminalStopMinutes: stop } : {})
  }
}

function wholeMinutes(value: number | undefined, fallback: number): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_DELAY_MINUTES
    ? value
    : fallback
}

/** On unless set false. */
export function forkWorkerArchiveEnabled(value: unknown): boolean {
  return readSettings(value).forkWorkerArchive !== false
}

export function forkWorkerArchiveDelayMinutes(value: unknown): number {
  return wholeMinutes(
    readSettings(value).forkWorkerArchiveDelayMinutes,
    FORK_WORKER_ARCHIVE_DEFAULT_DELAY_MINUTES
  )
}

export function forkWorkerTerminalStopMinutes(value: unknown): number {
  return wholeMinutes(
    readSettings(value).forkWorkerTerminalStopMinutes,
    FORK_WORKER_TERMINAL_STOP_DEFAULT_MINUTES
  )
}

/** The workspace has nothing to decide yet, or the user's own choice keeps it. */
export type ForkWorkerArchiveHold =
  | 'running'
  | 'stopped'
  | 'kept-open'
  | 'taken-over'
  | 'pinned'
  | 'used-after-done'
  | 'focused'

/** Work that removal would lose: the one-click "Remove anyway" asks first. */
export type ForkWorkerArchiveBlock = 'uncommitted-changes' | 'unmerged-commits' | 'git-unknown'

export type ForkWorkerArchiveReason =
  | ForkWorkerArchiveHold
  | ForkWorkerArchiveBlock
  | 'not-due'
  | 'remote-project'
  | 'not-a-git-workspace'

export type WorkerWorkspaceDispatchFacts = {
  state: string
  /** When the worker reported or its dispatch settled (ms). */
  finishedAtMs: number
  /** The user ran Keep open (or started it with --keep-open). */
  keptOpen: boolean
  /** The user took the terminal over, or it moved to another owner. */
  takenOver: boolean
}

export type WorkerWorkspaceFacts = {
  /** Every dispatch that used the workspace. */
  dispatches: readonly WorkerWorkspaceDispatchFacts[]
  pinned: boolean
  /** Someone typed into its chat or terminal, or an agent started a turn, after it finished. */
  usedAfterDone: boolean
  /** Its tab is the one a window shows now. */
  focused: boolean
}

export type WorkerWorkspaceLanding = {
  /** Changed, staged or untracked files; ignored build output does not count. Null: unreadable. */
  dirtyFiles: number | null
  /** Commits on the branch that are on no base branch, by patch; null: unreadable. */
  unlandedCommits: number | null
}

export type WorkerArchiveVerdict =
  | { kind: 'archive' }
  | { kind: 'wait'; dueAtMs: number }
  | { kind: 'hold'; reason: ForkWorkerArchiveHold }
  | { kind: 'blocked'; reason: ForkWorkerArchiveBlock; landing: WorkerWorkspaceLanding }

const SETTLED_OK = new Set(['succeeded', 'failed', 'abandoned'])

/** The finish time of the newest dispatch that used the workspace. */
export function workerWorkspaceFinishedAt(facts: Pick<WorkerWorkspaceFacts, 'dispatches'>): number {
  return Math.max(0, ...facts.dispatches.map((dispatch) => dispatch.finishedAtMs))
}

/**
 * Hold first (a worker that runs, or one the user keeps), then the delay, then what the checkout
 * holds. `ignoreDelay` is the manual cleanup, which acts on what is finished now. `readLanding`
 * runs git, so it is asked only for a workspace that passed everything before it.
 */
export async function decideWorkerWorkspace(args: {
  facts: WorkerWorkspaceFacts
  nowMs: number
  delayMs: number
  ignoreDelay: boolean
  readLanding: () => Promise<WorkerWorkspaceLanding>
}): Promise<WorkerArchiveVerdict> {
  const { facts } = args
  const { dispatches } = facts
  if (dispatches.length === 0 || dispatches.some((entry) => !isSettled(entry.state))) {
    return { kind: 'hold', reason: 'running' }
  }
  if (dispatches.some((entry) => entry.state === 'stopped')) {
    return { kind: 'hold', reason: 'stopped' }
  }
  if (dispatches.some((entry) => entry.keptOpen)) {
    return { kind: 'hold', reason: 'kept-open' }
  }
  if (dispatches.some((entry) => entry.takenOver)) {
    return { kind: 'hold', reason: 'taken-over' }
  }
  if (facts.pinned) {
    return { kind: 'hold', reason: 'pinned' }
  }
  if (facts.usedAfterDone) {
    return { kind: 'hold', reason: 'used-after-done' }
  }
  if (facts.focused) {
    return { kind: 'hold', reason: 'focused' }
  }
  const dueAtMs = workerWorkspaceFinishedAt(facts) + args.delayMs
  if (!args.ignoreDelay && args.nowMs < dueAtMs) {
    return { kind: 'wait', dueAtMs }
  }
  const landing = await args.readLanding()
  if (landing.dirtyFiles === null || landing.unlandedCommits === null) {
    return { kind: 'blocked', reason: 'git-unknown', landing }
  }
  if (landing.dirtyFiles > 0) {
    return { kind: 'blocked', reason: 'uncommitted-changes', landing }
  }
  if (landing.unlandedCommits > 0) {
    return { kind: 'blocked', reason: 'unmerged-commits', landing }
  }
  return { kind: 'archive' }
}

function isSettled(state: string): boolean {
  return SETTLED_OK.has(state) || state === 'stopped'
}

/** One workspace in a cleanup plan or result. */
export type ForkWorkerCleanupRow = {
  worktreeId: string
  name: string
  branch: string | null
  path: string
  botName: string | null
  finishedAtMs: number
  /** What happens: removed (or would be), left alone, or removal failed. */
  outcome: 'remove' | 'skip' | 'failed'
  /** Why it is left alone; absent when it is removed. */
  reason?: ForkWorkerArchiveReason
  dirtyFiles?: number | null
  unlandedCommits?: number | null
  /** "Remove anyway" may be offered: everything but a running worker or a non-git workspace. */
  canForce: boolean
  /** The worker's own server, for a row read from a paired server. */
  server?: string
  error?: string
}

export type ForkWorkerCleanupResult = {
  dryRun: boolean
  enabled: boolean
  rows: ForkWorkerCleanupRow[]
  /** Paired servers asked with `includeRemote`, and how each answered. */
  servers: {
    name: string
    /** The paired environment, so a row's "Remove anyway" reaches that server. */
    environmentId?: string
    ok: boolean
    error?: string
    rows: ForkWorkerCleanupRow[]
  }[]
}

export const ForkWorkerCleanupRunParams = z.object({
  bot: z.string().min(1).max(256).optional(),
  dryRun: z.boolean().optional(),
  includeRemote: z.boolean().optional(),
  /** Workspaces the user confirmed "Remove anyway" for. */
  force: z.array(z.string().min(1).max(1024)).max(500).optional(),
  /** Act on these workspaces only, for one row's "Remove anyway". */
  only: z.array(z.string().min(1).max(1024)).max(500).optional()
})
export type ForkWorkerCleanupRunParams = z.infer<typeof ForkWorkerCleanupRunParams>

/** What the sidebar shows for each held workspace: why it is still there. */
export type ForkWorkerArchiveStatus = {
  worktreeId: string
  reason: ForkWorkerArchiveReason
  /** When it will be archived on its own, for `not-due`. */
  dueAtMs?: number
  dirtyFiles?: number | null
  unlandedCommits?: number | null
  canForce: boolean
}

export const ForkWorkerArchiveStatusParams = z.object({})
export type ForkWorkerArchiveStatusParams = z.infer<typeof ForkWorkerArchiveStatusParams>

/** A window reports the workspace it shows; null when it shows none. Repeated about each minute. */
export const ForkWorkerArchiveFocusParams = z.object({
  clientId: z.string().min(1).max(128),
  worktreeId: z.string().min(1).max(1024).nullable()
})
export type ForkWorkerArchiveFocusParams = z.infer<typeof ForkWorkerArchiveFocusParams>

export const FORK_WORKER_CLEANUP_RUN_METHOD = 'fork.workerCleanup.run'
export const FORK_WORKER_CLEANUP_SERVER_TIMEOUT_MS = 120_000

export function isForcibleWorkerArchiveReason(reason: ForkWorkerArchiveReason): boolean {
  return reason !== 'running' && reason !== 'remote-project' && reason !== 'not-a-git-workspace'
}
