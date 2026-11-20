// Worker archive (FORK.md, BAD-669): which finished workers' idle agents and terminals to stop now.
// The workspace stays; only the process goes, through the stock release path, so the chat history
// still opens read-only and `orchestration send` reopens the worker. Pure: facts in, candidates out.
import { FORK_WORKER_ARCHIVE_REPORT_SLACK_MS } from '../../../shared/fork/worker-archive'
import type { WorkerCleanupCandidate } from '../worker-cleanup/worker-cleanup-query'

export type TerminalStopDeps = {
  nowMs: number
  stopAfterMs: number
  candidates: readonly WorkerCleanupCandidate[]
  inTurn: (candidate: WorkerCleanupCandidate) => boolean
  turnStartedAt: (paneKey: string) => number | undefined
}

/**
 * A worker is stopped once its report has been in for the delay, with no question open, no turn
 * running and no turn started after the report (someone typed into it or sent it more work).
 * Workers kept open never reach here: the candidate query leaves them out.
 */
export function pickWorkerTerminalsToStop(deps: TerminalStopDeps): WorkerCleanupCandidate[] {
  return deps.candidates.filter((candidate) => {
    if (candidate.pendingQuestion || deps.nowMs < candidate.doneAtMs + deps.stopAfterMs) {
      return false
    }
    const turnAt = candidate.paneKey ? deps.turnStartedAt(candidate.paneKey) : undefined
    if (turnAt !== undefined && turnAt > candidate.doneAtMs + FORK_WORKER_ARCHIVE_REPORT_SLACK_MS) {
      return false
    }
    return !deps.inTurn(candidate)
  })
}
