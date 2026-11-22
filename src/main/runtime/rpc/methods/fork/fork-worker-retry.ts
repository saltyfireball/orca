// Worker retry policy (BAD-681, FORK.md): `fork.workerRetry.policy` reads or changes a Run's own
// policy, `fork.workerRetry.show` lists the retries of a Task or a Run, for `orca retry`.
import { defineMethod } from '../../core'
import {
  ForkWorkerRetryPolicyParams,
  ForkWorkerRetryShowParams,
  resolveWorkerRetryPolicy,
  type ForkWorkerRetryShowResult
} from '../../../../../shared/fork/worker-retry'
import {
  clearRunPolicy,
  listRetries,
  readRunPolicy,
  writeRunPolicy
} from '../../../../fork/worker-retry/retry-store'

export const FORK_WORKER_RETRY_METHODS = [
  defineMethod({
    name: 'fork.workerRetry.policy',
    permission: 'workspace',
    params: ForkWorkerRetryPolicyParams,
    handler: async (params, ctx): Promise<ForkWorkerRetryShowResult> => {
      const db = ctx.runtime.getOrchestrationDb()
      const settings = ctx.runtime.requireStore().getSettings() as never
      const changes =
        params.clear === true ||
        params.enabled !== undefined ||
        params.max !== undefined ||
        params.backoffSeconds !== undefined
      if (changes && !params.run) {
        throw new Error('Name the Run with --run to change its retry policy.')
      }
      if (params.run && params.clear) {
        clearRunPolicy(db, params.run)
      } else if (params.run && changes) {
        writeRunPolicy(db, params.run, {
          ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
          ...(params.max !== undefined ? { max: params.max } : {}),
          ...(params.backoffSeconds !== undefined ? { backoffSeconds: params.backoffSeconds } : {})
        })
      }
      const own = params.run ? readRunPolicy(db, params.run) : null
      return {
        policy: { ...resolveWorkerRetryPolicy(settings, own), run: params.run ?? null, own },
        retries: params.run ? listRetries(db, { runId: params.run }) : []
      }
    }
  }),
  defineMethod({
    name: 'fork.workerRetry.show',
    permission: 'workspace',
    params: ForkWorkerRetryShowParams,
    handler: async (params, ctx): Promise<ForkWorkerRetryShowResult> => {
      const db = ctx.runtime.getOrchestrationDb()
      const settings = ctx.runtime.requireStore().getSettings() as never
      const own = params.run ? readRunPolicy(db, params.run) : null
      return {
        policy: { ...resolveWorkerRetryPolicy(settings, own), run: params.run ?? null, own },
        retries: listRetries(db, { taskId: params.task, runId: params.run })
      }
    }
  })
] as const
