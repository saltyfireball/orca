// Completion contract (BAD-676, FORK.md): fork.completionContract.show answers with a Task's done
// checks and every attempt, with the tail of each check's output, for `orca contract show`.
import { defineMethod } from '../../core'
import {
  ForkCompletionContractShowParams,
  type ForkCompletionContractShowResult
} from '../../../../../shared/fork/completion-contract-wire'
import { showWithServerEvidence } from '../../../../fork/completion-contract/contract-show'
import { boundedForkPairedCall } from '../../../../fork/paired-server-call/paired-server-call'

/** A paired server that is slow to answer must not hold `orca contract show` for long. */
const SERVER_SHOW_TIMEOUT_MS = 15_000

export const FORK_COMPLETION_CONTRACT_METHODS = [
  defineMethod({
    name: 'fork.completionContract.show',
    permission: 'workspace',
    params: ForkCompletionContractShowParams,
    handler: async (params, ctx): Promise<ForkCompletionContractShowResult> => {
      const call = boundedForkPairedCall((environmentId, method, callParams, timeoutMs) =>
        ctx.runtime.callOrchestrationWorkerServer(environmentId, method, callParams, timeoutMs)
      )
      return showWithServerEvidence(
        ctx.runtime.getOrchestrationDb(),
        params.task,
        (environmentId, method, callParams) =>
          call(environmentId, method, callParams, SERVER_SHOW_TIMEOUT_MS)
      )
    }
  })
] as const
