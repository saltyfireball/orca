// Completion contract (BAD-676, BAD-763): what `orca contract show` answers. The contract is kept on
// the Run home. When the worker ran on a paired server, that server ran the checks and holds the
// attempts, so the home reads them from there and shows them with its own.
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { ForkCompletionContractShowResult } from '../../../shared/fork/completion-contract-wire'
import { listAttempts, readContract } from './contract-store'
import { listReviewRuns, readReviewGate } from '../reviewer-gate/reviewer-store'

/** The Task's contract, review and attempts as this host's database holds them. */
export function showContractOf(
  db: OrchestrationDb,
  task: string
): ForkCompletionContractShowResult {
  const state = readContract(db, task)
  const review = readReviewGate(db, task)
  return {
    taskId: task,
    declared: state !== null,
    checks: state?.contract.checks ?? [],
    requirePrChecks: state?.contract.requirePrChecks ?? false,
    maxRounds: state?.contract.maxRounds ?? null,
    failedRounds: state?.failedRounds ?? 0,
    escalated: state?.escalated ?? false,
    review: review
      ? {
          focus: review.gate.focus,
          agent: review.gate.agent,
          maxRounds: review.gate.maxRounds,
          escalated: review.escalated,
          runs: listReviewRuns(db, task).map((run) => ({
            round: run.round,
            headSha: run.headSha,
            reviewer: run.reviewer,
            model: run.model,
            status: run.status,
            findingsCount: run.findingsCount,
            output: run.output,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt
          }))
        }
      : null,
    attempts: listAttempts(db, task).map(({ at, dispatchId, outcome, results }) => ({
      at,
      dispatchId,
      outcome,
      results
    }))
  }
}

export type CallPairedServer = (
  environmentId: string,
  method: string,
  params: unknown
) => Promise<unknown>

/** The paired servers a Task's workers were started on, from the home's own records. */
export function serversOfTask(
  db: OrchestrationDb,
  task: string
): { environmentId: string; name: string }[] {
  const rows = db.db
    .prepare(
      `SELECT DISTINCT f.environment_id AS environmentId, f.environment_name AS name
         FROM federated_dispatches f JOIN dispatch_contexts d ON d.id = f.dispatch_id
        WHERE d.task_id = ?`
    )
    .all(task) as { environmentId: string; name: string }[]
  return rows
}

function isShowResult(value: unknown): value is ForkCompletionContractShowResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { attempts?: unknown }).attempts)
  )
}

export async function showWithServerEvidence(
  db: OrchestrationDb,
  task: string,
  call: CallPairedServer
): Promise<ForkCompletionContractShowResult> {
  const home = showContractOf(db, task)
  const servers = serversOfTask(db, task)
  if (servers.length === 0) {
    return home
  }
  const merged: ForkCompletionContractShowResult = { ...home, attempts: [...home.attempts] }
  const seen: NonNullable<ForkCompletionContractShowResult['servers']> = []
  for (const server of servers) {
    try {
      const remote = await call(server.environmentId, 'fork.completionContract.show', { task })
      if (!isShowResult(remote)) {
        throw new Error('the server answered with something else')
      }
      merged.attempts.push(...remote.attempts)
      merged.failedRounds = Math.max(merged.failedRounds, remote.failedRounds)
      merged.escalated = merged.escalated || remote.escalated
      merged.review = remote.review ?? merged.review
      seen.push({ name: server.name, attempts: remote.attempts.length })
    } catch (error) {
      seen.push({
        name: server.name,
        attempts: 0,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  merged.attempts.sort((a, b) => a.at.localeCompare(b.at))
  merged.servers = seen
  return merged
}
