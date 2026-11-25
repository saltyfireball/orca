// Completion contract (BAD-676, FORK.md): the `fork.completionContract.show` RPC behind
// `orca contract show`. Plain object params, as the mobile RPC fence requires.
import { z } from 'zod'
import type { ForkDoneCheckResult } from './completion-contract'
import type { ReviewRunStatus } from './reviewer-gate'
import type { ForkWorkerRetryEntry } from './worker-retry'

export const ForkCompletionContractShowParams = z.object({
  task: z.string().trim().min(1).max(256)
})

/** BAD-816: the stored result of a worker's Task, for `worker-read`. */
export const ForkCompletionContractResultParams = z.object({
  dispatch: z.string().trim().min(1).max(256)
})

export type ForkCompletionContractShowResult = {
  taskId: string
  /** False when the Task declares no done checks. */
  declared: boolean
  checks: string[]
  requirePrChecks: boolean
  maxRounds: number | null
  failedRounds: number
  escalated: boolean
  /** BAD-683: the Task's review request and every review run; null when it asked for none. */
  review: {
    focus: string
    agent: string | null
    maxRounds: number | null
    escalated: boolean
    runs: {
      round: number
      headSha: string
      reviewer: string
      model: string
      status: ReviewRunStatus
      findingsCount: number
      output: string
      startedAt: string
      finishedAt: string | null
    }[]
  } | null
  /** BAD-681: each automatic retry of this Task's workers, with its reason and state. */
  retries?: ForkWorkerRetryEntry[]
  /** BAD-681: the retry that started this Task, when a retry did. */
  retryOf?: ForkWorkerRetryEntry | null
  /** BAD-763: the paired servers the Task's workers ran on and what each said about the checks. */
  servers?: { name: string; attempts: number; error?: string }[]
  attempts: {
    at: string
    dispatchId: string | null
    outcome: 'pass' | 'fail' | 'pending' | 'skipped'
    results: ForkDoneCheckResult[]
  }[]
}

/** BAD-676 later push: the Run home asks the paired server a settled Task ran on to read its PR. */
export const ForkCompletionContractLaterPushParams = z.object({
  task: z.string().trim().min(1).max(256)
})

/** What one read of a settled Task's pull request found, on the host its checks ran on. */
export type ForkLaterPushRead =
  | {
      kind: 'pass' | 'fail' | 'pending'
      head: string
      prNumber: number
      failed: string[]
      pending: string[]
    }
  /** The pull request is merged or closed: nothing more to watch. */
  | { kind: 'closed'; prNumber: number; state: string }
  /** gh could not answer now; read again later. */
  | { kind: 'unreadable'; reason: string }
  /** The workspace or the contract is gone: nothing more to watch. */
  | { kind: 'gone'; reason: string }
