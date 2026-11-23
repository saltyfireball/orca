// Completion contract (BAD-676, FORK.md): `orca contract show <task_id>`, also the Task's history of
// automatic worker retries (BAD-681).
import type { CommandHandler } from '../dispatch/dispatch'
import { getRequiredStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { ForkCompletionContractShowResult } from '../../shared/fork/completion-contract-wire'

export function formatForkContract(result: ForkCompletionContractShowResult): string {
  const tail = [...formatForkReview(result), ...formatForkRetries(result)]
  if (!result.declared) {
    const skipped = result.attempts.flatMap(formatForkAttempt)
    return tail.length > 0 || skipped.length > 0 || (result.servers ?? []).length > 0
      ? [...skipped, ...formatForkServers(result), ...tail].join('\n')
      : `Task ${result.taskId} declares no done checks, asks for no review and has no retries.`
  }
  const lines = [
    `Task ${result.taskId}: ${result.checks.length} command check(s)${result.requirePrChecks ? ', pull request checks required' : ''}, ${result.failedRounds} failed round(s)${result.escalated ? ', escalated' : ''}`
  ]
  for (const check of result.checks) {
    lines.push(`  check: ${check}`)
  }
  lines.push(...result.attempts.flatMap(formatForkAttempt))
  return [...lines, ...formatForkServers(result), ...tail].join('\n')
}

function formatForkAttempt(
  attempt: ForkCompletionContractShowResult['attempts'][number]
): string[] {
  const lines = [
    `${attempt.at} ${attempt.outcome}${attempt.dispatchId ? ` (${attempt.dispatchId})` : ''}`
  ]
  for (const entry of attempt.results) {
    if (attempt.outcome === 'skipped') {
      lines.push(`  ${entry.output}`)
      continue
    }
    const how = entry.ok ? 'ok' : entry.pending ? 'running' : `exit ${entry.exitCode ?? 'none'}`
    lines.push(`  ${entry.check}: ${how}`)
    if (entry.output) {
      lines.push(...entry.output.split('\n').map((line) => `    ${line}`))
    }
  }
  return lines
}

function formatForkServers(result: ForkCompletionContractShowResult): string[] {
  return (result.servers ?? []).map((server) =>
    server.error
      ? `server ${server.name}: cannot see its check evidence (${server.error})`
      : `server ${server.name}: ${server.attempts} check attempt(s) ran there`
  )
}

/** BAD-681: the Task's automatic worker retries, oldest first. */
function formatForkRetries(result: ForkCompletionContractShowResult): string[] {
  const retries = result.retries ?? []
  const lines: string[] = []
  if (result.retryOf) {
    lines.push(
      `Task ${result.taskId} was started by automatic retry ${result.retryOf.attempt} of Task ${result.retryOf.taskId}: ${result.retryOf.reason}`
    )
  }
  if (retries.length > 0) {
    lines.push(`Task ${result.taskId}: ${retries.length} automatic retry record(s)`)
  }
  for (const retry of retries) {
    const when = retry.status === 'scheduled' ? `, due ${retry.dueAt}` : ''
    const why = retry.detail ? ` (${retry.detail})` : ''
    const next = retry.retryDispatchId ? ` -> ${retry.retryDispatchId}` : ''
    lines.push(
      `${retry.at} retry ${retry.attempt} ${retry.status}${when}${why}: ${retry.reason} [${retry.dispatchId}${next}]`
    )
  }
  return lines
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
