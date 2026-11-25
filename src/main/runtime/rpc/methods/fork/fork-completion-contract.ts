// Completion contract (BAD-676, FORK.md): fork.completionContract.show answers with a Task's done
// checks and every attempt, with the tail of each check's output, for `orca contract show`;
// fork.completionContract.laterPush is a paired server's read of a settled Task's pull request.
import { defineMethod } from '../../core'
import {
  ForkCompletionContractResultParams,
  ForkCompletionContractLaterPushParams,
  ForkCompletionContractShowParams,
  type ForkCompletionContractShowResult,
  type ForkLaterPushRead
} from '../../../../../shared/fork/completion-contract-wire'
import { showWithServerEvidence } from '../../../../fork/completion-contract/contract-show'
import { forkLaterPushReadOnServer } from '../../../../fork/completion-contract/later-push-live'
import { boundedForkPairedCall } from '../../../../fork/paired-server-call/paired-server-call'
import { forkResultOfDispatch } from '../../../../fork/completion-contract/result-schema-live'

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
  }),
  defineMethod({
    // BAD-816: `worker-read` adds the Task's stored result, as data.
    name: 'fork.completionContract.result',
    permission: 'workspace',
    params: ForkCompletionContractResultParams,
    handler: (params, ctx) =>
      forkResultOfDispatch(ctx.runtime.getOrchestrationDb(), params.dispatch)
  }),
  defineMethod({
    // The Run home's later-push watch asks the server a settled Task's worker ran on (BAD-676).
    name: 'fork.completionContract.laterPush',
    permission: 'workspace',
    params: ForkCompletionContractLaterPushParams,
    handler: (params, ctx): Promise<ForkLaterPushRead> =>
      forkLaterPushReadOnServer(ctx.runtime, ctx.runtime.getOrchestrationDb(), params.task)
  })
] as const
