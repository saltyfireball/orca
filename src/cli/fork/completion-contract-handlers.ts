// Completion contract (BAD-676, FORK.md): `orca contract show <task_id>`.
import type { CommandHandler } from '../dispatch/dispatch'
import { getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { ForkCompletionContractShowResult } from '../../shared/fork/completion-contract-wire'

export function formatForkContract(result: ForkCompletionContractShowResult): string {
  const review = formatForkReview(result)
  if (!result.declared) {
    return result.review
      ? review.join('\n')
      : `Task ${result.taskId} declares no done checks and asks for no review.`
  }
  const lines = [
    `Task ${result.taskId}: ${result.checks.length} command check(s)${result.requirePrChecks ? ', pull request checks required' : ''}, ${result.failedRounds} failed round(s)${result.escalated ? ', escalated' : ''}`
  ]
  for (const check of result.checks) {
    lines.push(`  check: ${check}`)
  }
  for (const attempt of result.attempts) {
    lines.push(
      `${attempt.at} ${attempt.outcome}${attempt.dispatchId ? ` (${attempt.dispatchId})` : ''}`
    )
    for (const entry of attempt.results) {
      const how = entry.ok ? 'ok' : entry.pending ? 'running' : `exit ${entry.exitCode ?? 'none'}`
      lines.push(`  ${entry.check}: ${how}`)
      if (entry.output) {
        lines.push(...entry.output.split('\n').map((line) => `    ${line}`))
      }
    }
  }
  return [...lines, ...review].join('\n')
}

function formatForkReview(result: ForkCompletionContractShowResult): string[] {
  const { review } = result
  if (!review) {
    return []
  }
  const lines = [
    `Task ${result.taskId}: review of focus ${review.focus} by ${review.agent ?? 'the other provider'}${review.escalated ? ', escalated' : ''}`
  ]
  for (const run of review.runs) {
    lines.push(
      `${run.startedAt} round ${run.round} ${run.reviewer} (${run.model}) at ${run.headSha.slice(0, 12)}: ${run.status}${run.status === 'findings' ? ` (${run.findingsCount})` : ''}`
    )
    if (run.output) {
      lines.push(...run.output.split('\n').map((line) => `    ${line}`))
    }
  }
  return lines
}

export const FORK_COMPLETION_CONTRACT_HANDLERS: Record<string, CommandHandler> = {
  'contract show': async (ctx) => {
    const task = getRequiredStringFlag(ctx.flags, 'task')
    const result = await ctx.client
      .call<ForkCompletionContractShowResult>('fork.completionContract.show', { task })
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no completion contract. Update it and try again.'
          )
        }
        throw error
      })
    printResult(result, ctx.json, formatForkContract)
  }
}
