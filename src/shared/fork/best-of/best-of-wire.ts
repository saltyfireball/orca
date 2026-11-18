// Best of N (FORK.md, SLRM-2393): the fork.bestOf.* RPC contract. The CLI starts the attempts
// through the stock orchestration methods and records the run here; main keeps the runs and
// answers each attempt's facts from its own orchestration database and usage ledger.
import { z } from 'zod'
import {
  FORK_BEST_OF_LOSER_ACTIONS,
  FORK_BEST_OF_MAX_ATTEMPTS,
  FORK_BEST_OF_PROMPT_MAX,
  type ForkBestOfChecks,
  type ForkBestOfRun
} from './best-of'

const Id = z.string().trim().min(1).max(512)
const Short = z.string().trim().min(1).max(256)

// Plain objects with no transforms or defaults: the mobile RPC fence refuses a schema whose parsed
// shape is wider than what a sender may send.
const Attempt = z.object({
  index: z.number().int().min(1).max(FORK_BEST_OF_MAX_ATTEMPTS),
  agent: Short,
  model: Short.optional(),
  effort: Short.optional(),
  host: Short,
  dispatchId: Id.optional(),
  taskId: Id.optional(),
  runId: Id.optional(),
  startError: z.string().max(2000).optional()
})

export const ForkBestOfRecordParams = z.object({
  prompt: z.string().min(1).max(FORK_BEST_OF_PROMPT_MAX),
  repo: Short.optional(),
  baseBranch: Short.optional(),
  attempts: z.array(Attempt).min(1).max(FORK_BEST_OF_MAX_ATTEMPTS)
})
export type ForkBestOfRecordParams = z.infer<typeof ForkBestOfRecordParams>

export const ForkBestOfListParams = z.object({})
export const ForkBestOfShowParams = z.object({ id: Id })

const Outcome = z.object({
  kind: z.enum(['kept', 'archived', 'removed', 'left', 'failed']),
  message: z.string().max(2000).optional()
})

export const ForkBestOfSettleParams = z.object({
  id: Id,
  winner: z.number().int().min(1).max(FORK_BEST_OF_MAX_ATTEMPTS),
  loserAction: z.enum(FORK_BEST_OF_LOSER_ACTIONS),
  outcomes: z
    .array(
      z.object({ index: z.number().int().min(1).max(FORK_BEST_OF_MAX_ATTEMPTS), outcome: Outcome })
    )
    .max(FORK_BEST_OF_MAX_ATTEMPTS)
})
export type ForkBestOfSettleParams = z.infer<typeof ForkBestOfSettleParams>

export const ForkBestOfForgetParams = z.object({ id: Id })

/** Tokens and estimated cost of an attempt's native Claude chats, from the usage ledger. */
export type ForkBestOfCost = {
  costUsd: number | null
  totalTokens: number
  subscriptionTokens: number
  unpricedTokens: number
}

/** What main knows of one attempt now: its worker, its task's report, its cost. */
export type ForkBestOfAttemptFacts = {
  index: number
  /** The worktree as its owning host knows it; null until the worker has one. */
  worktreeId: string | null
  /** The paired server that owns the worktree; null for this machine. */
  environmentId: string | null
  /** The server's name, for display. */
  hostLabel: string | null
  workerState: string | null
  workerError: string | null
  taskStatus: string | null
  /** The worker's own report (worker_done), as the task keeps it. */
  report: string | null
  checks: ForkBestOfChecks
  /** Null when the ledger has nothing for the worktree (another host, or not a native chat). */
  cost: ForkBestOfCost | null
}

export type ForkBestOfListResult = { runs: ForkBestOfRun[] }
export type ForkBestOfRunResult = { run: ForkBestOfRun }
export type ForkBestOfShowResult = { run: ForkBestOfRun; facts: ForkBestOfAttemptFacts[] }
