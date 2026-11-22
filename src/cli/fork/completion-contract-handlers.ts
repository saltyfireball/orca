// Completion contract (BAD-676, FORK.md): `orca contract show <task_id>`.
import type { CommandHandler } from '../dispatch/dispatch'
import { getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { ForkCompletionContractShowResult } from '../../shared/fork/completion-contract-wire'

export function formatForkContract(result: ForkCompletionContractShowResult): string {
  if (!result.declared) {
    return `Task ${result.taskId} declares no done checks.`
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
  return lines.join('\n')
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
