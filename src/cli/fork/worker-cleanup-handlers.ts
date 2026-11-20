// BAD-669 (FORK.md "Worker archive"): `orca orchestration worker-cleanup`, through the host's
// fork.workerCleanup.run RPC. The host removes what is due; this prints what happened.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  FORK_WORKER_CLEANUP_RUN_METHOD,
  type ForkWorkerCleanupResult,
  type ForkWorkerCleanupRow
} from '../../shared/fork/worker-archive'
import { workerArchiveReasonText } from '../../shared/fork/worker-archive-text'

function where(row: ForkWorkerCleanupRow): string {
  return row.server ? `${row.server}: ${row.path}` : row.path
}

function verdictText(row: ForkWorkerCleanupRow, dryRun: boolean): string {
  if (row.outcome === 'remove') {
    return dryRun ? 'would remove' : 'removed'
  }
  if (row.outcome === 'failed') {
    return `failed: ${row.error ?? 'unknown error'}`
  }
  return `skipped: ${row.reason ? workerArchiveReasonText(row.reason, row) : 'unknown'}`
}

export function formatWorkerCleanup(result: ForkWorkerCleanupResult): string {
  const rows = [...result.rows, ...result.servers.flatMap((server) => server.rows)]
  const lines: string[] = []
  if (rows.length === 0) {
    lines.push('No finished worker workspaces found.')
  } else {
    const table = rows.map((row) => [
      verdictText(row, result.dryRun),
      row.botName ?? '-',
      row.name,
      row.branch ?? '(detached)',
      where(row)
    ])
    const widths = [0, 1, 2, 3].map((col) => Math.max(...table.map((cells) => cells[col].length)))
    for (const cells of table) {
      lines.push(
        cells
          .map((cell, col) => (col === cells.length - 1 ? cell : cell.padEnd(widths[col])))
          .join('  ')
      )
    }
  }
  for (const server of result.servers) {
    if (!server.ok) {
      lines.push(`Note: ${server.name}: not cleaned up: ${server.error ?? 'no answer'}`)
    }
  }
  const removed = rows.filter((row) => row.outcome === 'remove').length
  lines.push(
    result.dryRun
      ? `Dry run: ${removed} would be removed. Nothing was changed.`
      : `${removed} removed. Git branches were kept.`
  )
  return lines.join('\n')
}

export const FORK_WORKER_CLEANUP_HANDLERS: Record<string, CommandHandler> = {
  'orchestration worker-cleanup': async (ctx) => {
    const bot = getOptionalStringFlag(ctx.flags, 'bot')
    const result = await ctx.client
      .call<ForkWorkerCleanupResult>(FORK_WORKER_CLEANUP_RUN_METHOD, {
        ...(bot ? { bot } : {}),
        dryRun: ctx.flags.has('dry-run'),
        includeRemote: ctx.flags.has('include-remote')
      })
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no worker cleanup. Update it and try again.'
          )
        }
        throw error
      })
    printResult(result, ctx.json, formatWorkerCleanup)
  }
}
