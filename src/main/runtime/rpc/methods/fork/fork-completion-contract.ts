// Completion contract (BAD-676, FORK.md): fork.completionContract.show answers with a Task's done
// checks and every attempt, with the tail of each check's output, for `orca contract show`.
import { defineMethod } from '../../core'
import {
  ForkCompletionContractShowParams,
  type ForkCompletionContractShowResult
} from '../../../../../shared/fork/completion-contract-wire'
import { listAttempts, readContract } from '../../../../fork/completion-contract/contract-store'

export const FORK_COMPLETION_CONTRACT_METHODS = [
  defineMethod({
    name: 'fork.completionContract.show',
    permission: 'workspace',
    params: ForkCompletionContractShowParams,
    handler: async (params, ctx): Promise<ForkCompletionContractShowResult> => {
      const db = ctx.runtime.getOrchestrationDb()
      const state = readContract(db, params.task)
      return {
        taskId: params.task,
        declared: state !== null,
        checks: state?.contract.checks ?? [],
        requirePrChecks: state?.contract.requirePrChecks ?? false,
        maxRounds: state?.contract.maxRounds ?? null,
        failedRounds: state?.failedRounds ?? 0,
        escalated: state?.escalated ?? false,
        attempts: listAttempts(db, params.task).map(({ at, dispatchId, outcome, results }) => ({
          at,
          dispatchId,
          outcome,
          results
        }))
      }
    }
  })
] as const
