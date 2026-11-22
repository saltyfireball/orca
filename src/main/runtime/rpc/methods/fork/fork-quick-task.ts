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
  FORK_CARD_ROUTE_CLAIMS_METHOD,
  FORK_CARD_ROUTE_START_METHOD,
  ForkCardRouteClaimsParams,
  ForkCardRouteStartParams,
  type ForkCardRouteClaimsResult,
  type ForkCardRouteStartResult
} from '../../../../../shared/fork/card-routing'
import { runtimeCardChatStart } from '../../../../fork/card-routing/card-route-start'
import { runtimeCardRouteClaims } from '../../../../fork/card-routing/card-route-claims'
import { FORK_OWNER_TOKEN_METHODS } from './fork-owner-token'

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
  }),
  // BAD-737: each bot's repos here, for a card nothing labels or maps.
  defineMethod({
    name: FORK_CARD_ROUTE_CLAIMS_METHOD,
    permission: 'workspace',
    params: ForkCardRouteClaimsParams,
    handler: async (params, ctx): Promise<ForkCardRouteClaimsResult> =>
      runtimeCardRouteClaims(ctx.runtime)(params)
  }),
  // BAD-737: the owner token, and the item answer it allows, ride here so the registry stays as it is.
  ...FORK_OWNER_TOKEN_METHODS
] as const
