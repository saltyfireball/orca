// Worker archive (FORK.md, BAD-669): one pass over the workspaces worker starts created. It turns
// the facts into a row per workspace (removed, or left with the reason) and removes those that
// are due. No runtime, Electron or git here: every dependency is injected, so each rule is
// tested with fakes. Never deletes a branch and never touches a workspace a worker did not create.
import {
  FORK_WORKER_ARCHIVE_REPORT_SLACK_MS,
  decideWorkerWorkspace,
  forkWorkerArchiveDelayMinutes,
  isForcibleWorkerArchiveReason,
  workerWorkspaceFinishedAt,
  type ForkWorkerArchiveReason,
  type ForkWorkerArchiveStatus,
  type ForkWorkerCleanupRow,
  type WorkerWorkspaceLanding
} from '../../../shared/fork/worker-archive'
import type { WorkerWorkspaceRecord } from './worker-archive-query'

/** Stock stamps whole seconds; a workspace made after the worker started reuses a path, not a worker. */
const CREATED_CLOCK_SLACK_MS = 1_000
/** Another client's activity stamp this soon after the report is not use of the worker. */
const ACTIVITY_STAMP_SLACK_MS = 60_000

export type WorkerArchiveWorktree = {
  id: string
  name: string
  path: string
  branch: string | null
  baseRef?: string
  createdAt?: number
  isPinned: boolean
  isMainWorktree: boolean
  lastActivityAt: number
  /** Why git cannot be read here (another host's project, a folder): the workspace is left alone. */
  unsupported?: 'remote-project' | 'not-a-git-workspace'
}

export type WorkerArchiveBot = { id: string; name: string }

export type WorkerArchiveDeps = {
  settings: unknown
  nowMs: number
  records: readonly WorkerWorkspaceRecord[]
  worktree: (worktreeId: string) => WorkerArchiveWorktree | undefined
  /** When the agent in this pane last started a turn in this run. */
  turnStartedAt: (paneKey: string) => number | undefined
  /** Workspaces a window shows now. */
  focused: ReadonlySet<string>
  botOf: (record: WorkerWorkspaceRecord) => WorkerArchiveBot | null
  landing: (worktree: WorkerArchiveWorktree) => Promise<WorkerWorkspaceLanding>
  /** Removes the checkout through `worktree rm`: terminals stopped, branch kept. */
  remove: (worktree: WorkerArchiveWorktree, force: boolean) => Promise<void>
}

export type WorkerArchiveOptions = {
  /** `auto` waits out the delay; `manual` acts on everything that is finished now. */
  mode: 'auto' | 'manual'
  /** Only workers a bot started: its name or id. */
  bot?: string
  dryRun: boolean
  /** Workspaces the user confirmed "Remove anyway" for. */
  force?: ReadonlySet<string>
  /** Act on these workspaces only. */
  only?: ReadonlySet<string>
}

export type WorkerArchiveOutcome = {
  rows: ForkWorkerCleanupRow[]
  /** The same workspaces as sidebar status: why each is still there. */
  status: ForkWorkerArchiveStatus[]
}

function sameBot(bot: WorkerArchiveBot | null, wanted: string): boolean {
  const needle = wanted.trim().toLowerCase()
  return bot !== null && (bot.id.toLowerCase() === needle || bot.name.toLowerCase() === needle)
}

function usedAfterDone(
  deps: WorkerArchiveDeps,
  record: WorkerWorkspaceRecord,
  worktree: WorkerArchiveWorktree,
  finishedAtMs: number
): boolean {
  for (const dispatch of record.dispatches) {
    const turnAt = dispatch.paneKey ? deps.turnStartedAt(dispatch.paneKey) : undefined
    if (
      turnAt !== undefined &&
      turnAt > dispatch.finishedAtMs + FORK_WORKER_ARCHIVE_REPORT_SLACK_MS
    ) {
      return true
    }
  }
  return worktree.lastActivityAt > finishedAtMs + ACTIVITY_STAMP_SLACK_MS
}

export async function runWorkerArchivePass(
  deps: WorkerArchiveDeps,
  options: WorkerArchiveOptions
): Promise<WorkerArchiveOutcome> {
  const delayMs = forkWorkerArchiveDelayMinutes(deps.settings) * 60_000
  const rows: ForkWorkerCleanupRow[] = []
  const status: ForkWorkerArchiveStatus[] = []
  for (const record of deps.records) {
    const worktree = deps.worktree(record.worktreeId)
    if (!worktree || worktree.isMainWorktree) {
      continue
    }
    // A workspace made later at the same path is the user's, not the worker's.
    if (
      worktree.createdAt === undefined ||
      worktree.createdAt >= record.created.workerStartedAt + CREATED_CLOCK_SLACK_MS
    ) {
      continue
    }
    if (options.only && !options.only.has(worktree.id)) {
      continue
    }
    const bot = deps.botOf(record)
    if (options.bot !== undefined && !sameBot(bot, options.bot)) {
      continue
    }
    const finishedAtMs = workerWorkspaceFinishedAt(record)
    const base = {
      worktreeId: worktree.id,
      name: worktree.name,
      branch: worktree.branch,
      path: worktree.path,
      botName: bot?.name ?? null,
      finishedAtMs
    }
    const skip = (
      reason: ForkWorkerArchiveReason,
      extra: Partial<ForkWorkerCleanupRow> = {},
      dueAtMs?: number
    ): void => {
      const canForce = isForcibleWorkerArchiveReason(reason)
      rows.push({ ...base, outcome: 'skip', reason, canForce, ...extra })
      status.push({
        worktreeId: worktree.id,
        reason,
        canForce,
        ...(dueAtMs !== undefined ? { dueAtMs } : {}),
        ...(extra.dirtyFiles !== undefined ? { dirtyFiles: extra.dirtyFiles } : {}),
        ...(extra.unlandedCommits !== undefined ? { unlandedCommits: extra.unlandedCommits } : {})
      })
    }
    if (worktree.unsupported) {
      skip(worktree.unsupported)
      continue
    }
    const verdict = await decideWorkerWorkspace({
      facts: {
        dispatches: record.dispatches,
        pinned: worktree.isPinned,
        usedAfterDone: usedAfterDone(deps, record, worktree, finishedAtMs),
        focused: deps.focused.has(worktree.id)
      },
      nowMs: deps.nowMs,
      delayMs,
      ignoreDelay: options.mode === 'manual',
      readLanding: () =>
        deps.landing(worktree).catch(() => ({ dirtyFiles: null, unlandedCommits: null }))
    })
    const confirmed = options.force?.has(worktree.id) === true
    if (
      verdict.kind === 'archive' ||
      (confirmed && verdict.kind !== 'wait' && !isRunning(verdict))
    ) {
      const force = verdict.kind !== 'archive'
      if (options.dryRun) {
        rows.push({ ...base, outcome: 'remove', canForce: false })
        continue
      }
      try {
        await deps.remove(worktree, force)
        rows.push({ ...base, outcome: 'remove', canForce: false })
      } catch (error) {
        rows.push({
          ...base,
          outcome: 'failed',
          canForce: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      continue
    }
    if (verdict.kind === 'wait') {
      skip('not-due', {}, verdict.dueAtMs)
    } else if (verdict.kind === 'hold') {
      skip(verdict.reason)
    } else {
      skip(verdict.reason, {
        dirtyFiles: verdict.landing.dirtyFiles,
        unlandedCommits: verdict.landing.unlandedCommits
      })
    }
  }
  return { rows, status }
}

function isRunning(verdict: { kind: string; reason?: string }): boolean {
  return verdict.kind === 'hold' && verdict.reason === 'running'
}
