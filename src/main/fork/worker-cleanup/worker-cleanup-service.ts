// Worker cleanup (FORK.md): the sweep wired to this process's runtime, database, git and gh. One
// hook in the orchestration database binding installs it and hands over the stock auto-release
// while the setting is on. The desktop bridge publishes its notices and runs Undo.
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { ghExecFileAsync } from '../../git/command-runner/hosted-cli/gh-exec-file'
import { isFolderRepo } from '../../../shared/repository/repo-kind'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host/execution-host'
import { splitWorktreeId } from '../../../shared/worktree/id'
import type { Repo } from '../../../shared/repository/repo-types'
import type { ForkGlobalSettings } from '../../../shared/fork/fork-global-settings'
import {
  forkWorkerCleanupEnabled,
  type ForkWorkerCleanupHeld,
  type ForkWorkerCleanupNotice
} from '../../../shared/fork/worker-cleanup'
import type { WorkerTerminalReleaseRuntime } from '../../runtime/orchestration/terminal-authority/release/worker-terminal-release-runtime'
import { closeStructuredAgentSessionChild } from '../../runtime/agent-session/lifecycle/structured-agent-session-close'
import type { LostWorkGit } from '../lost-work/lost-work-git'
import { startForkBackoffTimer } from '../fork-backoff-timer'
import { installForkWorkerArchive } from '../worker-archive/worker-archive-service'
import { listWorkerCleanupCandidates } from './worker-cleanup-query'
import { chatSessionOf, closeThroughStockRelease } from './worker-cleanup-release'
import { forkWorkerTurnStartedAt } from './worker-cleanup-activity'
import {
  isWorkerBranchMerged,
  readWorkerWorktreeState,
  type WorkerCleanupGh
} from './worker-cleanup-git'
import { runWorkerCleanupSweep, WorkerCleanupMemory } from './worker-cleanup-sweep'
import {
  rememberNotice,
  publishWorkerCleanup,
  setWorkerCleanupHeld
} from './worker-cleanup-notices'

export const FORK_WORKER_CLEANUP_SWEEP_MS = 60_000
/** While the setting is off the sweep backs off to this; turning it on is seen within it. */
export const FORK_WORKER_CLEANUP_IDLE_SWEEP_MS = 5 * 60_000

export type WorkerCleanupStore = {
  getSettings?: () => unknown
  getRepos: () => Repo[]
  onSettingsChanged?: (listener: (updates: Partial<ForkGlobalSettings>) => void) => unknown
}

const git: LostWorkGit = async (args, options) =>
  (await gitExecFileAsync(args, { cwd: options.cwd, signal: options.signal })).stdout
const gh: WorkerCleanupGh = async (args, options) =>
  (await ghExecFileAsync(args, { cwd: options.cwd, signal: options.signal })).stdout

function localWorktreePath(store: WorkerCleanupStore, worktreeId: string | null): string | null {
  const parsed = worktreeId ? splitWorktreeId(worktreeId) : null
  const repo = parsed && store.getRepos().find((entry) => entry.id === parsed.repoId)
  if (!parsed || !repo || isFolderRepo(repo)) {
    return null
  }
  return getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID ? parsed.worktreePath : null
}

/** True while worker cleanup owns finished workers, so the stock auto-release stands aside. */
export function forkWorkerCleanupOwnsRelease(settings: unknown): boolean {
  return forkWorkerCleanupEnabled(settings)
}

type Installed = {
  runtime: WorkerTerminalReleaseRuntime
  store: WorkerCleanupStore
  memory: WorkerCleanupMemory
  sinceMs: number
  running: boolean
}

let installed: Installed | null = null
let stopSweepTimer: (() => void) | null = null
const storesWatched = new WeakSet<object>()

// One timer serves every install: each sweep reads the current `installed`.
function startSweepTimer(): void {
  stopSweepTimer?.()
  stopSweepTimer = startForkBackoffTimer({
    run: sweepForkWorkerCleanup,
    baseMs: FORK_WORKER_CLEANUP_SWEEP_MS,
    maxMs: FORK_WORKER_CLEANUP_IDLE_SWEEP_MS
  })
}

/** The runtime worker cleanup acts on, for Undo. */
export function forkWorkerCleanupRuntime(): WorkerTerminalReleaseRuntime | null {
  return installed?.runtime ?? null
}

/** Hook: called whenever the runtime binds its orchestration database. Idempotent. */
export function installForkWorkerCleanup(
  runtime: WorkerTerminalReleaseRuntime,
  store: WorkerCleanupStore | null | undefined
): void {
  if (!store || installed?.runtime === runtime) {
    return
  }
  installed = {
    runtime,
    store,
    memory: new WorkerCleanupMemory(),
    sinceMs: Date.now(),
    running: false
  }
  if (!stopSweepTimer) {
    startSweepTimer()
  }
  // BAD-669: the worker archive and the idle terminal stop run beside this sweep.
  installForkWorkerArchive(runtime)
  if (store.onSettingsChanged && !storesWatched.has(store)) {
    storesWatched.add(store)
    // The backed-off wait starts over when the setting changes, so turning it on is seen within
    // one sweep interval, as with the old fixed timer.
    store.onSettingsChanged((updates) => {
      if ('forkWorkerCleanup' in updates && stopSweepTimer) {
        startSweepTimer()
      }
    })
  }
}

/**
 * One sweep; does nothing while the setting is off or a sweep is still running. Resolves false
 * only when the setting is off, so the sweep timer backs off while there is nothing to own.
 */
export async function sweepForkWorkerCleanup(): Promise<boolean> {
  const state = installed
  if (!state || state.running) {
    return true
  }
  const settings = state.store.getSettings?.()
  if (!forkWorkerCleanupEnabled(settings)) {
    setWorkerCleanupHeld([])
    return false
  }
  state.running = true
  try {
    const { runtime } = state
    const db = runtime.getOrchestrationDb()
    const result = await runWorkerCleanupSweep(
      {
        settings,
        nowMs: Date.now(),
        candidates: listWorkerCleanupCandidates(db, state.sinceMs),
        inTurn: (candidate) =>
          runtime.isWorkerAgentInTurn({
            pane_key: candidate.paneKey,
            terminal_handle: candidate.terminalHandle
          }),
        turnStartedAt: forkWorkerTurnStartedAt,
        worktreePath: (candidate) => localWorktreePath(state.store, candidate.worktreeId),
        worktreeState: (path) => readWorkerWorktreeState(git, path),
        isMerged: (path) => isWorkerBranchMerged(git, gh, path),
        chatSession: (candidate) => chatSessionOf(candidate.terminalHandle, db),
        close: (candidates) => closeThroughStockRelease(runtime, db, candidates),
        release: async (candidate, sessionId) => {
          const outcome = await closeStructuredAgentSessionChild(sessionId, {
            // No surface: the tab stays, only the agent stops.
            surface: null,
            admitClose: () =>
              !runtime.isWorkerAgentInTurn({
                pane_key: candidate.paneKey,
                terminal_handle: candidate.terminalHandle
              })
          })
          return outcome.stopped
        }
      },
      state.memory
    )
    setWorkerCleanupHeld(result.held)
    if (result.items.length > 0) {
      publishWorkerCleanup(rememberNotice(result.items))
    }
  } catch (error) {
    console.warn('[fork worker cleanup] sweep failed', error)
  } finally {
    state.running = false
  }
  return true
}

export type { ForkWorkerCleanupHeld, ForkWorkerCleanupNotice }
