// Goal loop (BAD-682, FORK.md): `orca goal`, through the host's fork.goal.* RPC.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import {
  getOptionalNumberFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import { describeGoalUntil, goalStopTitle } from '../../shared/fork/goal-loop'
import type {
  ForkGoalClearResult,
  ForkGoalListResult,
  ForkGoalRow,
  ForkGoalSetResult
} from '../../shared/fork/goal-loop-wire'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no goal loop. Update it and try again.'
    )
  }
  throw error
}

const money = (usd: number): string => `$${usd.toFixed(2)}`

/** `$5`, `5` or `5.50`; empty is none. */
export function parseGoalBudget(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined
  }
  const value = Number(raw.trim().replace(/^\$/u, ''))
  if (!Number.isFinite(value) || value < 0) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--budget takes an amount in USD, like 5 or $5.'
    )
  }
  return value
}

function rowLine(goal: ForkGoalRow): string {
  const state = goal.stop ? goalStopTitle(goal.stop.reason) : 'running'
  const budget =
    goal.budgetUsd > 0 ? `${money(goal.spentUsd)}/${money(goal.budgetUsd)}` : 'no budget'
  const lines = [
    `${goal.id.slice(0, 8)}  ${state}  round ${goal.rounds}/${goal.roundLimit}  ${budget}  ${goal.title}`.trimEnd(),
    `  ${describeGoalUntil(goal.until)}`
  ]
  if (goal.stop) {
    lines.push(`  ${goal.stop.text}`)
  }
  return lines.join('\n')
}

export function formatGoals(result: ForkGoalListResult): string {
  if (result.goals.length === 0) {
    return result.enabled ? 'No goals.' : 'No goals. The goal loop is off (forkGoalLoop).'
  }
  return [
    ...(result.enabled ? [] : ['The goal loop is off (forkGoalLoop): no goal is checked.']),
    ...result.goals.map(rowLine)
  ].join('\n')
}

function requireId(ctx: HandlerContext): string {
  return getRequiredStringFlag(ctx.flags, 'id')
}

export const FORK_GOAL_LOOP_HANDLERS: Record<string, CommandHandler> = {
  'goal set': async (ctx) => {
    const untilCmd = getOptionalStringFlag(ctx.flags, 'until-cmd')
    const untilJudge = getOptionalStringFlag(ctx.flags, 'until-judge')
    if (Boolean(untilCmd) === Boolean(untilJudge)) {
      throw new RuntimeClientError(
        'invalid_argument',
        "Give exactly one of --until-cmd '<command>' and --until-judge '<criteria>'."
      )
    }
    const maxRounds = getOptionalNumberFlag(ctx.flags, 'max-rounds')
    if (
      maxRounds !== undefined &&
      (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 200)
    ) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--max-rounds is a whole number from 1 to 200.'
      )
    }
    const budgetUsd = parseGoalBudget(getOptionalStringFlag(ctx.flags, 'budget'))
    const reply = await ctx.client
      .call<ForkGoalSetResult>('fork.goal.set', {
        id: requireId(ctx),
        ...(untilCmd ? { untilCmd } : {}),
        ...(untilJudge ? { untilJudge } : {}),
        ...(maxRounds !== undefined ? { maxRounds } : {}),
        ...(budgetUsd !== undefined ? { budgetUsd } : {})
      })
      .catch(incompatible)
    printResult(reply, ctx.json, (r) => `Goal set.\n${rowLine(r.goal)}`)
  },
  'goal list': async (ctx) => {
    const reply = await ctx.client
      .call<ForkGoalListResult>('fork.goal.list', {})
      .catch(incompatible)
    printResult(reply, ctx.json, formatGoals)
  },
  'goal clear': async (ctx) => {
    const reply = await ctx.client
      .call<ForkGoalClearResult>('fork.goal.clear', { id: requireId(ctx) })
      .catch(incompatible)
    printResult(reply, ctx.json, (r) =>
      r.cleared ? `Goal cleared: ${r.id}` : `No goal for ${r.id}.`
    )
  }
}
