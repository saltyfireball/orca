// Goal loop (BAD-682, FORK.md): fork.goal.* behind `orca goal`. Set, clear and list the goals of
// the agents on this host. The check command and the judge criteria come only from the caller of
// `fork.goal.set`; nothing an agent wrote reaches a shell.
import { defineMethod } from '../../core'
import {
  ForkGoalListParams,
  ForkGoalSetParams,
  ForkGoalTargetParams,
  type ForkGoalClearResult,
  type ForkGoalListResult,
  type ForkGoalSetResult
} from '../../../../../shared/fork/goal-loop-wire'
import { goalLoopService, rearmForkGoalLoop } from '../../../../fork/goal-loop/goal-live'

export const FORK_GOAL_LOOP_METHODS = [
  defineMethod({
    name: 'fork.goal.set',
    permission: 'workspace',
    params: ForkGoalSetParams,
    handler: async (params, ctx): Promise<ForkGoalSetResult> => {
      const result = await goalLoopService(ctx.runtime).set(params)
      rearmForkGoalLoop()
      return result
    }
  }),
  defineMethod({
    name: 'fork.goal.clear',
    permission: 'workspace',
    params: ForkGoalTargetParams,
    handler: (params, ctx): Promise<ForkGoalClearResult> =>
      goalLoopService(ctx.runtime).clear(params.id)
  }),
  defineMethod({
    name: 'fork.goal.list',
    permission: 'workspace',
    params: ForkGoalListParams,
    handler: (_params, ctx): Promise<ForkGoalListResult> => goalLoopService(ctx.runtime).list()
  })
] as const
