// Completion contract (BAD-676, FORK.md): the `fork.completionContract.show` RPC behind
// `orca contract show`. Plain object params, as the mobile RPC fence requires.
import { z } from 'zod'
import type { ForkDoneCheckResult } from './completion-contract'

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
  attempts: {
    at: string
    dispatchId: string | null
    outcome: 'pass' | 'fail' | 'pending'
    results: ForkDoneCheckResult[]
  }[]
}
