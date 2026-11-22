// Worker retry policy (BAD-681, FORK.md): `orca retry policy` and `orca retry show`.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalNonNegativeIntegerFlag, getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { ForkWorkerRetryShowResult } from '../../shared/fork/worker-retry'
import type { RuntimeRpcSuccess } from '../../shared/remote-runtime/rpc/runtime-rpc-envelope'

export function formatForkWorkerRetry(result: ForkWorkerRetryShowResult): string {
  const { policy } = result
  const lines = [
    `${policy.run ? `Run ${policy.run}: ` : ''}retries ${policy.enabled ? 'on' : 'off'}, up to ${policy.max} per Task, first wait ${Math.round(policy.backoffMs / 1000)}s (doubling, at most ${Math.round(policy.maxBackoffMs / 1000)}s)`
  ]
  for (const retry of result.retries) {
    lines.push(
      `${retry.at} ${retry.taskId} retry ${retry.attempt} ${retry.status}: ${retry.reason}${retry.retryDispatchId ? ` -> ${retry.retryDispatchId}` : ''}${retry.detail ? ` (${retry.detail})` : ''}`
    )
  }
  return lines.join('\n')
}

async function call(
  ctx: Parameters<CommandHandler>[0],
  method: string,
  params: Record<string, unknown>
): Promise<RuntimeRpcSuccess<ForkWorkerRetryShowResult>> {
  return ctx.client.call<ForkWorkerRetryShowResult>(method, params).catch((error: unknown) => {
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'This Orca host has no worker retry policy. Update it and try again.'
      )
    }
    throw error
  })
}

export const FORK_WORKER_RETRY_HANDLERS: Record<string, CommandHandler> = {
  'retry policy': async (ctx) => {
    const on = ctx.flags.get('on') === true
    const off = ctx.flags.get('off') === true
    if (on && off) {
      throw new RuntimeClientError('invalid_argument', '--on and --off cannot be used together.')
    }
    const max = getOptionalNonNegativeIntegerFlag(ctx.flags, 'max')
    const backoff = getOptionalNonNegativeIntegerFlag(ctx.flags, 'backoff')
    const run = getOptionalStringFlag(ctx.flags, 'run')
    const result = await call(ctx, 'fork.workerRetry.policy', {
      ...(run ? { run } : {}),
      ...(on || off ? { enabled: on } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(backoff !== undefined ? { backoffSeconds: backoff } : {}),
      ...(ctx.flags.get('clear') === true ? { clear: true } : {})
    })
    printResult(result, ctx.json, formatForkWorkerRetry)
  },
  'retry show': async (ctx) => {
    const task = getOptionalStringFlag(ctx.flags, 'task')
    const run = getOptionalStringFlag(ctx.flags, 'run')
    const result = await call(ctx, 'fork.workerRetry.show', {
      ...(task ? { task } : {}),
      ...(run ? { run } : {})
    })
    printResult(result, ctx.json, formatForkWorkerRetry)
  }
}
