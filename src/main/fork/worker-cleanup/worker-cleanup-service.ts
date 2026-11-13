// Worker cleanup (FORK.md): the sweep wired to this process's runtime, database, git and gh. One
// hook in the orchestration database binding installs it and hands over the stock auto-release
// while the setting is on. The desktop bridge publishes its notices and runs Undo.
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { ghExecFileAsync } from '../../git/command-runner/hosted-cli/gh-exec-file'
import { isFolderRepo } from '../../../shared/repo-kind'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { splitWorktreeId } from '../../../shared/worktree/id'
import type { Repo } from '../../../shared/repo-types'
import {
  forkWorkerCleanupEnabled,
  type ForkWorkerCleanupHeld,
  type ForkWorkerCleanupItem,
  type ForkWorkerCleanupNotice
} from '../../../shared/fork/worker-cleanup'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { WorkerTerminalReleaseRuntime } from '../../runtime/orchestration/terminal-authority/release/worker-terminal-release-runtime'
import { reconcileRequestedWorkerTerminalReleases } from '../../runtime/orchestration/terminal-authority/release/worker-terminal-release-reconciliation'
import {
  requireRunningStructuredWorker,
  resolveStructuredWorkerIdentity
} from '../../runtime/orchestration/terminal-authority/structured-sessions/structured-worker-authority'
import { closeStructuredAgentSessionChild } from '../../runtime/agent-session/structured-agent-session-close'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { LostWorkGit } from '../lost-work/lost-work-git'
import { claimWorkerCleanupRelease, listWorkerCleanupCandidates } from './worker-cleanup-query'
import type { WorkerCleanupCandidate } from './worker-cleanup-query'
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

export type WorkerCleanupStore = {
  getSettings?: () => unknown
  getRepos: () => Repo[]
}

const git: LostWorkGit = async (args, options) =>
  (await gitExecFileAsync(args, { cwd: options.cwd, signal: options.signal })).stdout
const gh: WorkerCleanupGh = async (args, options) =>
  (await ghExecFileAsync(args, { cwd: options.cwd, signal: options.signal })).stdout

/** True while worker cleanup owns finished workers, so the stock auto-release stands aside. */
export function forkWorkerCleanupOwnsRelease(settings: unknown): boolean {
  return forkWorkerCleanupEnabled(settings)
}

function chatSessionOf(handle: string, db: OrchestrationDb): string | null {
  const identity = resolveStructuredWorkerIdentity(handle, db)
  if (!identity) {
    return null
  }
  try {
    return requireRunningStructuredWorker(identity).sessionId
  } catch {
    return identity.sessionId
  }
}

function localWorktreePath(store: WorkerCleanupStore, worktreeId: string | null): string | null {
  const parsed = worktreeId ? splitWorktreeId(worktreeId) : null
  const repo = parsed && store.getRepos().find((entry) => entry.id === parsed.repoId)
  if (!parsed || !repo || isFolderRepo(repo)) {
    return null
  }
  return getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID ? parsed.worktreePath : null
}

async function closeThroughStockRelease(
  runtime: WorkerTerminalReleaseRuntime,
  db: OrchestrationDb,
  candidates: WorkerCleanupCandidate[]
): Promise<ForkWorkerCleanupItem[]> {
  const now = Date.now()
  const claimed = candidates.flatMap((candidate) => {
    // Read the chat before release: a closed session no longer resolves its successor.
    const sessionId = chatSessionOf(candidate.terminalHandle, db)
    return claimWorkerCleanupRelease(db, candidate.resourceId, now)
      ? [{ candidate, sessionId }]
      : []
  })
  if (claimed.length === 0) {
    return []
  }
  await reconcileRequestedWorkerTerminalReleases(runtime)
  const host = getStructuredAgentSessionHost()
  return claimed.flatMap(({ candidate, sessionId }): ForkWorkerCleanupItem[] => {
    const row = db.getWorkerTerminalResource(candidate.resourceId)
    if (!row || row.release_state !== 'released' || !candidate.worktreeId) {
      return []
    }
    if (sessionId) {
      const agent = host?.sessionAgent(sessionId) ?? null
      return agent
        ? [
            {
              kind: 'chat-closed',
              worktreeId: candidate.worktreeId,
              sessionId,
              agent
            }
          ]
        : []
    }
    return [
      {
        kind: 'terminal-closed',
        worktreeId: candidate.worktreeId,
        handle: row.terminal_handle
      }
    ]
  })
}

type Installed = {
  runtime: WorkerTerminalReleaseRuntime
  store: WorkerCleanupStore
  memory: WorkerCleanupMemory
  sinceMs: number
  running: boolean
}

let installed: Installed | null = null

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
  const timer = setInterval(() => void sweepForkWorkerCleanup(), FORK_WORKER_CLEANUP_SWEEP_MS)
  timer.unref?.()
}

/** One sweep; does nothing while the setting is off or a sweep is still running. */
export async function sweepForkWorkerCleanup(): Promise<void> {
  const state = installed
  if (!state || state.running) {
    return
  }
  const settings = state.store.getSettings?.()
  if (!forkWorkerCleanupEnabled(settings)) {
    setWorkerCleanupHeld([])
    return
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
}

export type { ForkWorkerCleanupHeld, ForkWorkerCleanupNotice }
