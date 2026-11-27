// Worker archive (FORK.md, BAD-669): the archive pass and the terminal stop wired to this
// process's runtime, store and git. One hook inside installForkWorkerCleanup starts the timer;
// the desktop, `orca serve` and orcad all run it for their own workspaces. A manual cleanup
// (fork.workerCleanup.run) runs the same pass with the delay waived.
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { isFolderRepo } from '../../../shared/repository/repo-kind'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host/execution-host'
import { splitWorktreeId } from '../../../shared/worktree/id'
import {
  folderWorkspaceKey,
  worktreeWorkspaceKey
} from '../../../shared/workspace/identity/workspace-scope'
import type { Repo } from '../../../shared/repository/repo-types'
import type { RuntimeWorktreeRecord } from '../../../shared/worktree/catalog/runtime-worktree-contracts'
import {
  forkWorkerArchiveEnabled,
  forkWorkerTerminalStopMinutes,
  type ForkWorkerArchiveStatus,
  type ForkWorkerCleanupResult,
  type ForkWorkerCleanupRow
} from '../../../shared/fork/worker-archive'
import type { ForkWorkerCleanupItem } from '../../../shared/fork/worker-cleanup'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { readAgentSessionRecordStore } from '../../runtime/orchestration/addressing/session-lineage/structured-session-lineage'
import { queueWorkspaceDelete } from '../../runtime/workspaces/lifecycle/workspace-lifecycle-commands'
import type { Bot } from '../../../shared/bot-types'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { LostWorkGit } from '../lost-work/lost-work-git'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { forkWorkerTurnStartedAt } from '../worker-cleanup/worker-cleanup-activity'
import { listWorkerCleanupCandidates } from '../worker-cleanup/worker-cleanup-query'
import { closeThroughStockRelease } from '../worker-cleanup/worker-cleanup-release'
import { publishWorkerCleanup, rememberNotice } from '../worker-cleanup/worker-cleanup-notices'
import { installForkBotChatAutoClose } from '../bot-chat-close/bot-chat-auto-close-service'
import { installForkAutomationRunAutoClose } from '../automation-run-close/automation-run-auto-close-service'
import { forkFocusedWorkspaces } from './worker-archive-activity'
import {
  runWorkerArchivePass,
  type WorkerArchiveBot,
  type WorkerArchiveDeps,
  type WorkerArchiveWorktree
} from './worker-archive-cleanup'
import { readWorkerArchiveLanding } from './worker-archive-git'
import { listWorkerWorkspaceRecords, type WorkerWorkspaceRecord } from './worker-archive-query'
import { pickWorkerTerminalsToStop } from './worker-archive-terminal-stop'

export const FORK_WORKER_ARCHIVE_SWEEP_MS = 60_000
export const FORK_WORKER_ARCHIVE_IDLE_SWEEP_MS = 5 * 60_000

/** What the sweep needs of a runtime; the real one is an OrcaRuntimeService. */
type ArchiveRuntime = OrcaRuntimeService

const git: LostWorkGit = async (args, options) =>
  (await gitExecFileAsync(args, { cwd: options.cwd, signal: options.signal })).stdout

function isArchiveRuntime(runtime: unknown): runtime is ArchiveRuntime {
  // The hook receives the runtime through a narrower type; the real one has these methods.
  return (
    typeof runtime === 'object' &&
    runtime !== null &&
    'listManagedWorktrees' in runtime &&
    typeof runtime.listManagedWorktrees === 'function' &&
    'removeManagedWorktree' in runtime &&
    typeof runtime.removeManagedWorktree === 'function'
  )
}

function worktreeView(
  record: RuntimeWorktreeRecord,
  repos: readonly Repo[]
): WorkerArchiveWorktree {
  const repo = repos.find((entry) => entry.id === record.repoId)
  const unsupported = !repo
    ? ('not-a-git-workspace' as const)
    : isFolderRepo(repo)
      ? ('not-a-git-workspace' as const)
      : getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID
        ? ('remote-project' as const)
        : undefined
  return {
    id: record.id,
    name: record.displayName,
    path: record.path,
    branch: record.branch ? record.branch.replace(/^refs\/heads\//, '') : null,
    ...(record.baseRef ? { baseRef: record.baseRef } : {}),
    ...(record.createdAt !== undefined ? { createdAt: record.createdAt } : {}),
    isPinned: record.isPinned === true,
    isMainWorktree: record.isMainWorktree === true,
    lastActivityAt: record.lastActivityAt ?? 0,
    ...(unsupported ? { unsupported } : {})
  }
}

/** The bot whose home started the worker: by the chat that started it, else by lineage. */
function makeBotOf(runtime: ArchiveRuntime) {
  const bots = runtime.bots?.list() ?? []
  const records = readAgentSessionRecordStore()
  const store = runtime.requireStore?.()
  return (record: WorkerWorkspaceRecord): WorkerArchiveBot | null => {
    if (bots.length === 0) {
      return null
    }
    const homes = new Map<string, Bot>(
      bots.map((bot) => [folderWorkspaceKey(bot.folderWorkspaceId), bot])
    )
    for (const dispatch of record.dispatches) {
      const workspace = dispatch.creatorSessionId
        ? records?.getRecord(dispatch.creatorSessionId)?.location.workspaceId
        : undefined
      const bot = workspace ? homes.get(workspace) : undefined
      if (bot) {
        return { id: bot.id, name: bot.name }
      }
    }
    const parent = store?.getWorkspaceLineage?.(
      worktreeWorkspaceKey(record.worktreeId)
    )?.parentWorkspaceKey
    const bot = parent ? homes.get(parent) : undefined
    return bot ? { id: bot.id, name: bot.name } : null
  }
}

async function buildDeps(runtime: ArchiveRuntime, settings: unknown): Promise<WorkerArchiveDeps> {
  const store = runtime.requireStore?.()
  const repos = store?.getRepos() ?? []
  const listed = await runtime.listManagedWorktrees(undefined, Number.MAX_SAFE_INTEGER)
  const byId = new Map(listed.worktrees.map((entry) => [entry.id, entry]))
  return {
    settings,
    nowMs: Date.now(),
    records: listWorkerWorkspaceRecords(runtime.getOrchestrationDb()),
    worktree: (id) => {
      const record = byId.get(id)
      return record ? worktreeView(record, repos) : undefined
    },
    turnStartedAt: forkWorkerTurnStartedAt,
    focused: forkFocusedWorkspaces(),
    botOf: makeBotOf(runtime),
    landing: (worktree) => readWorkerArchiveLanding(git, worktree.path, worktree.baseRef),
    remove: async (worktree, force) => {
      const selector = `id:${worktree.id}`
      const parsed = splitWorktreeId(worktree.id)
      const repo = parsed ? repos.find((entry) => entry.id === parsed.repoId) : undefined
      const hostId = repo ? getRepoExecutionHostId(repo) : undefined
      // The same path as `orca worktree rm`: terminals stopped, checkout removed, branch kept.
      await queueWorkspaceDelete(
        runtime,
        selector,
        hostId === LOCAL_EXECUTION_HOST_ID ? undefined : hostId,
        { deleteBranch: false, force },
        (removal) =>
          runtime.removeManagedWorktree(selector, { ...removal, waitForBackgroundRemoval: true })
      )
    }
  }
}

function settingsOf(runtime: ArchiveRuntime): unknown {
  try {
    return runtime.requireStore?.().getSettings()
  } catch {
    return undefined
  }
}

/** Why each held workspace is still there, from the last pass; read by fork.workerCleanup.status. */
let lastStatus: ForkWorkerArchiveStatus[] = []

export function readForkWorkerArchiveStatus(): ForkWorkerArchiveStatus[] {
  return lastStatus
}

/**
 * The manual cleanup: every finished worker workspace now, the delay waived. A dry run only
 * lists. `force` names the workspaces the user confirmed "Remove anyway" for.
 */
export async function runForkWorkerCleanupLocal(
  runtime: unknown,
  params: { bot?: string; dryRun: boolean; force?: readonly string[]; only?: readonly string[] }
): Promise<ForkWorkerCleanupResult> {
  if (!isArchiveRuntime(runtime)) {
    return { dryRun: params.dryRun, enabled: false, rows: [], servers: [] }
  }
  const settings = settingsOf(runtime)
  const deps = await buildDeps(runtime, settings)
  const outcome = await runWorkerArchivePass(deps, {
    mode: 'manual',
    ...(params.bot !== undefined ? { bot: params.bot } : {}),
    dryRun: params.dryRun,
    force: new Set(params.force ?? []),
    ...(params.only ? { only: new Set(params.only) } : {})
  })
  if (!params.dryRun && params.bot === undefined) {
    lastStatus = outcome.status
  }
  return {
    dryRun: params.dryRun,
    enabled: forkWorkerArchiveEnabled(settings),
    rows: outcome.rows,
    servers: []
  }
}

type Installed = { runtime: ArchiveRuntime; running: boolean }
let installed: Installed | null = null
let stopTimer: (() => void) | null = null

/** Hook (from installForkWorkerCleanup): starts the archive timer for this runtime. */
export function installForkWorkerArchive(runtime: unknown): void {
  if (!isArchiveRuntime(runtime) || installed?.runtime === runtime) {
    return
  }
  installed = { runtime, running: false }
  installForkBotChatAutoClose(runtime)
  installForkAutomationRunAutoClose(runtime)
  stopTimer ??= startForkBackoffTimer({
    run: sweepForkWorkerArchive,
    baseMs: FORK_WORKER_ARCHIVE_SWEEP_MS,
    maxMs: FORK_WORKER_ARCHIVE_IDLE_SWEEP_MS
  })
}

function describeRows(rows: readonly ForkWorkerCleanupRow[]): string {
  return rows.map((row) => `${row.name}:${row.outcome}`).join(', ')
}

/** One timer tick; resolves false while the setting is off so the timer backs off. */
export async function sweepForkWorkerArchive(): Promise<boolean> {
  const state = installed
  if (!state || state.running) {
    return true
  }
  const settings = settingsOf(state.runtime)
  if (!forkWorkerArchiveEnabled(settings)) {
    lastStatus = []
    return false
  }
  state.running = true
  try {
    await stopIdleTerminals(state.runtime, settings)
    const deps = await buildDeps(state.runtime, settings)
    const { rows, status } = await runWorkerArchivePass(deps, {
      mode: 'auto',
      dryRun: false
    })
    lastStatus = status
    const failed = rows.filter((row) => row.outcome === 'failed')
    if (failed.length > 0) {
      console.warn('[fork worker archive] could not remove', describeRows(failed))
    }
  } catch (error) {
    console.warn('[fork worker archive] sweep failed', error)
  } finally {
    state.running = false
  }
  return true
}

async function stopIdleTerminals(runtime: ArchiveRuntime, settings: unknown): Promise<void> {
  const db: OrchestrationDb = runtime.getOrchestrationDb()
  const due = pickWorkerTerminalsToStop({
    nowMs: Date.now(),
    stopAfterMs: forkWorkerTerminalStopMinutes(settings) * 60_000,
    candidates: listWorkerCleanupCandidates(db, 0),
    inTurn: (candidate) =>
      runtime.isWorkerAgentInTurn({
        pane_key: candidate.paneKey,
        terminal_handle: candidate.terminalHandle
      }),
    turnStartedAt: forkWorkerTurnStartedAt
  })
  if (due.length === 0) {
    return
  }
  const items: ForkWorkerCleanupItem[] = await closeThroughStockRelease(runtime, db, due)
  if (items.length > 0) {
    publishWorkerCleanup(rememberNotice(items))
  }
}
