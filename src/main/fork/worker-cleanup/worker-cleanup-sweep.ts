// Worker cleanup (FORK.md): one pass over the finished workers. Each guard that applies leaves a
// worker open; a worker past every guard with a trigger due is closed or released. No Electron
// and no runtime here, so every guard and trigger is tested with fakes.
import {
  forkWorkerCleanupAction,
  forkWorkerCleanupGraceMinutes,
  forkWorkerCleanupOnDone,
  forkWorkerCleanupOnMerged,
  type ForkWorkerCleanupHeld,
  type ForkWorkerCleanupItem
} from '../../../shared/fork/worker-cleanup'
import type { WorkerCleanupCandidate } from './worker-cleanup-query'
import type { WorkerWorktreeState } from './worker-cleanup-git'

/** A report's time has whole-second precision; a turn this close after it is the reporting turn. */
const REPORT_CLOCK_SLACK_MS = 1_000
/** How long one merged answer is reused, so gh and git are not asked every minute. */
export const MERGED_CACHE_MS = 5 * 60_000

export type WorkerCleanupSweepDeps = {
  settings: unknown
  nowMs: number
  candidates: WorkerCleanupCandidate[]
  inTurn: (candidate: WorkerCleanupCandidate) => boolean
  turnStartedAt: (paneKey: string) => number | undefined
  /** The worktree folder on this machine, or null (no worktree, not a local git project). */
  worktreePath: (candidate: WorkerCleanupCandidate) => string | null
  worktreeState: (path: string) => Promise<WorkerWorktreeState>
  isMerged: (path: string) => Promise<boolean>
  /** The chat session behind a native chat worker; null for a terminal worker. */
  chatSession: (candidate: WorkerCleanupCandidate) => string | null
  /** Close these through the stock release path; returns what actually closed. */
  close: (candidates: WorkerCleanupCandidate[]) => Promise<ForkWorkerCleanupItem[]>
  /** Stop a chat worker's agent and keep its tab; true when it stopped. */
  release: (candidate: WorkerCleanupCandidate, sessionId: string) => Promise<boolean>
}

export type WorkerCleanupSkip =
  | 'used-after-done'
  | 'question-open'
  | 'report-unread'
  | 'in-turn'
  | 'not-due'
  | 'no-local-worktree'
  | 'worktree-unknown'
  | 'uncommitted'
  | 'unpushed'
  | 'released'

export type WorkerCleanupSweepResult = {
  items: ForkWorkerCleanupItem[]
  held: ForkWorkerCleanupHeld[]
  skipped: Map<string, WorkerCleanupSkip>
}

/** Sweep state that outlives one pass: released chats and cached merged answers. */
export class WorkerCleanupMemory {
  readonly released = new Set<string>()
  private readonly merged = new Map<string, { atMs: number; merged: boolean }>()

  async isMerged(path: string, nowMs: number, ask: (path: string) => Promise<boolean>) {
    const cached = this.merged.get(path)
    if (cached && nowMs - cached.atMs < MERGED_CACHE_MS) {
      return cached.merged
    }
    const merged = await ask(path).catch(() => false)
    this.merged.set(path, { atMs: nowMs, merged })
    return merged
  }
}

function releaseKey(candidate: WorkerCleanupCandidate): string {
  return `${candidate.resourceId}\n${candidate.dispatchId}`
}

export async function runWorkerCleanupSweep(
  deps: WorkerCleanupSweepDeps,
  memory: WorkerCleanupMemory
): Promise<WorkerCleanupSweepResult> {
  const graceMs = forkWorkerCleanupGraceMinutes(deps.settings) * 60_000
  const onDone = forkWorkerCleanupOnDone(deps.settings)
  const onMerged = forkWorkerCleanupOnMerged(deps.settings)
  const releaseOnly = forkWorkerCleanupAction(deps.settings) === 'release'
  const skipped = new Map<string, WorkerCleanupSkip>()
  const held: ForkWorkerCleanupHeld[] = []
  const toClose: WorkerCleanupCandidate[] = []
  const items: ForkWorkerCleanupItem[] = []

  for (const candidate of deps.candidates) {
    const skip = (why: WorkerCleanupSkip): void => void skipped.set(candidate.resourceId, why)
    if (memory.released.has(releaseKey(candidate))) {
      skip('released')
      continue
    }
    const turnAt = candidate.paneKey ? deps.turnStartedAt(candidate.paneKey) : undefined
    if (turnAt !== undefined && turnAt > candidate.doneAtMs + REPORT_CLOCK_SLACK_MS) {
      skip('used-after-done')
      continue
    }
    if (candidate.pendingQuestion) {
      skip('question-open')
      continue
    }
    if (candidate.unreadReport) {
      skip('report-unread')
      continue
    }
    if (deps.inTurn(candidate)) {
      skip('in-turn')
      continue
    }
    const path = deps.worktreePath(candidate)
    if (!path) {
      skip('no-local-worktree')
      continue
    }
    const doneDue = onDone && deps.nowMs >= candidate.doneAtMs + graceMs
    const due = doneDue || (onMerged && (await memory.isMerged(path, deps.nowMs, deps.isMerged)))
    if (!due) {
      skip('not-due')
      continue
    }
    const state = await deps.worktreeState(path).catch(() => ({ dirty: null, unpushed: null }))
    const sessionId = deps.chatSession(candidate)
    if (state.dirty === null || state.unpushed === null) {
      skip('worktree-unknown')
      continue
    }
    if (state.dirty > 0 || state.unpushed > 0) {
      const reason = state.dirty > 0 ? 'uncommitted' : 'unpushed'
      skip(reason)
      if (candidate.paneKey) {
        held.push({ paneKey: candidate.paneKey, sessionId, reason })
      }
      continue
    }
    if (releaseOnly && sessionId) {
      if (await deps.release(candidate, sessionId).catch(() => false)) {
        memory.released.add(releaseKey(candidate))
        if (candidate.worktreeId && candidate.paneKey) {
          items.push({
            kind: 'chat-released',
            worktreeId: candidate.worktreeId,
            sessionId,
            paneKey: candidate.paneKey
          })
        }
      }
      continue
    }
    toClose.push(candidate)
  }
  if (toClose.length > 0) {
    items.push(...(await deps.close(toClose)))
  }
  return { items, held, skipped }
}
