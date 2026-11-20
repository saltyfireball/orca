// Quick task (SLRM-2428, FORK.md): `quickTask.submit`, for `orca quick-task` and the phone. The
// desktop box calls the same service over its own IPC.
import { defineMethod } from '../../core'
import {
  QUICK_TASK_SUBMIT_METHOD,
  type QuickTaskSubmitResult
} from '../../../../../shared/fork/quick-task-contract'
import { QuickTaskSubmitParamsSchema } from '../../../../../shared/fork/quick-task'
import { runtimeQuickTask } from '../../../../fork/quick-task/quick-task-runtime'

export const FORK_QUICK_TASK_METHODS = [
  defineMethod({
    name: QUICK_TASK_SUBMIT_METHOD,
    permission: 'workspace',
    params: QuickTaskSubmitParamsSchema,
    handler: async (params, ctx): Promise<QuickTaskSubmitResult> =>
      runtimeQuickTask(ctx.runtime).submit(params)
  })
] as const
