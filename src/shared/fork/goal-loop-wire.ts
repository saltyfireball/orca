// Goal loop (BAD-682, FORK.md): the fork.goal.* RPC contract behind `orca goal`. Plain objects
// with no transforms or defaults, as the mobile RPC fence requires.
import { z } from 'zod'
import {
  GOAL_LOOP_MAX_BUDGET_USD,
  GOAL_LOOP_MAX_COMMAND_CHARS,
  GOAL_LOOP_MAX_CRITERIA_CHARS,
  type GoalRecord
} from './goal-loop'

export const ForkGoalSetParams = z.object({
  /** A chat session id or terminal pane key, or a unique prefix of 4+ characters. */
  id: z.string().trim().min(1).max(600),
  untilCmd: z.string().trim().min(1).max(GOAL_LOOP_MAX_COMMAND_CHARS).optional(),
  untilJudge: z.string().trim().min(1).max(GOAL_LOOP_MAX_CRITERIA_CHARS).optional(),
  maxRounds: z.number().int().min(1).max(200).optional(),
  budgetUsd: z.number().min(0).max(GOAL_LOOP_MAX_BUDGET_USD).optional()
})

export const ForkGoalTargetParams = z.object({
  id: z.string().trim().min(1).max(600)
})
export const ForkGoalListParams = z.object({})

export type ForkGoalRow = Pick<
  GoalRecord,
  | 'id'
  | 'kind'
  | 'agent'
  | 'title'
  | 'until'
  | 'status'
  | 'rounds'
  | 'maxRounds'
  | 'budgetUsd'
  | 'createdAt'
  | 'lastFailure'
  | 'stop'
> & {
  /** The round limit that applies (the goal's own, else the setting). */
  roundLimit: number
  /** USD spent since the goal was set, from the usage ledger. */
  spentUsd: number
}

export type ForkGoalListResult = { goals: ForkGoalRow[]; enabled: boolean }
export type ForkGoalSetResult = { goal: ForkGoalRow }
export type ForkGoalClearResult = { id: string; cleared: boolean }

export type ForkGoalSetRequest = z.infer<typeof ForkGoalSetParams>
