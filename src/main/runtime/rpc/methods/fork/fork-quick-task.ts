// Quick task (SLRM-2428, FORK.md): `quickTask.submit`, for `orca quick-task` and the phone. The
// desktop box calls the same service over its own IPC. Card routing (BAD-694) rides along here:
// `fork.cardRoute.start`, for `orca card route --hand-off`.
import { defineMethod } from '../../core'
import {
  QUICK_TASK_SUBMIT_METHOD,
  type QuickTaskSubmitResult
} from '../../../../../shared/fork/quick-task-contract'
import { QuickTaskSubmitParamsSchema } from '../../../../../shared/fork/quick-task'
import { runtimeQuickTask } from '../../../../fork/quick-task/quick-task-runtime'
import {
  FORK_CARD_ROUTE_START_METHOD,
  ForkCardRouteStartParams,
  type ForkCardRouteStartResult
} from '../../../../../shared/fork/card-routing'
import { runtimeCardChatStart } from '../../../../fork/card-routing/card-route-start'

export const FORK_QUICK_TASK_METHODS = [
  defineMethod({
    name: QUICK_TASK_SUBMIT_METHOD,
    permission: 'workspace',
    params: QuickTaskSubmitParamsSchema,
    handler: async (params, ctx): Promise<QuickTaskSubmitResult> =>
      runtimeQuickTask(ctx.runtime).submit(params)
  }),
  defineMethod({
    name: FORK_CARD_ROUTE_START_METHOD,
    permission: 'workspace',
    params: ForkCardRouteStartParams,
    handler: async (params, ctx): Promise<ForkCardRouteStartResult> =>
      runtimeCardChatStart(ctx.runtime)(params)
  })
] as const
