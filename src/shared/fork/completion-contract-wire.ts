// Completion contract (BAD-676, FORK.md): the `fork.completionContract.show` RPC behind
// `orca contract show`. Plain object params, as the mobile RPC fence requires.
import { z } from 'zod'
import type { ForkDoneCheckResult } from './completion-contract'
import type { ReviewRunStatus } from './reviewer-gate'

export const ForkCompletionContractShowParams = z.object({
  task: z.string().trim().min(1).max(256)
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
  attempts: {
    at: string
    dispatchId: string | null
    outcome: 'pass' | 'fail' | 'pending'
    results: ForkDoneCheckResult[]
  }[]
}
