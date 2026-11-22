// BAD-691 (FORK.md "Worktree reclaim"): `orca workspace reclaim`, through the host's
// fork.worktreeReclaim.run RPC. The host does the deleting; this prints what happened.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { RuntimeClientError } from '../runtime/connection/types'
import { printResult } from '../output/command-result-output'
import {
  parseReclaimIdle,
  type ForkWorktreeReclaimResult,
  type ForkWorktreeReclaimSkipReason
} from '../../shared/fork/worktree-reclaim'

// A walk over big dependency folders can pass the stock 60 second RPC limit.
const RECLAIM_TIMEOUT_MS = 30 * 60_000

const SKIP: Record<ForkWorktreeReclaimSkipReason, string> = {
  'in-use': 'in use (agent, chat, terminal or open now)',
  'not-idle': 'active within the idle period',
  'not-tracked': 'not tracked by Orca',
  'missing-folder': 'folder is missing',
  'main-checkout': 'main checkout',
  'git-error': 'git could not list its ignored files'
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

export function formatWorktreeReclaim(result: ForkWorktreeReclaimResult): string {
  const lines: string[] = []
  if (!result.enabled) {
    lines.push(
      'Reclaim is off (setting forkWorktreeReclaim); this is a dry run. Turn it on with `orca settings set forkWorktreeReclaim true`.'
    )
  }
  const verb = result.dryRun ? 'would remove' : 'removed'
  for (const row of result.worktrees) {
    const place = `${row.repoName}  ${row.branch ?? '(detached)'}  ${row.path}`
    if (row.skipReason) {
      lines.push(`skipped  ${place}: ${SKIP[row.skipReason]}`)
      continue
    }
    if (row.entries.length === 0) {
      lines.push(`nothing  ${place}`)
      continue
    }
    lines.push(
      `${row.repoName}  ${row.branch ?? '(detached)'}  ${row.path}  ${verb} ${formatBytes(row.bytes)}`
    )
    for (const entry of row.entries) {
      const state = entry.skipped ? `left alone (${entry.skipped})` : formatBytes(entry.bytes)
      lines.push(`  ${entry.path}  ${state}`)
    }
  }
  if (result.worktrees.length === 0) {
    lines.push('No workspaces found.')
  }
  lines.push(
    `Total ${verb}: ${formatBytes(result.totalBytes)} (idle for ${result.idleDays} day(s) or more)`
  )
  for (const note of result.notes) {
    lines.push(`Note: ${note}`)
  }
  return lines.join('\n')
}

export const FORK_WORKTREE_RECLAIM_HANDLERS: Record<string, CommandHandler> = {
  'workspace reclaim': async (ctx) => {
    const idleText = getOptionalStringFlag(ctx.flags, 'idle')
    const idleDays = idleText === undefined ? undefined : parseReclaimIdle(idleText)
    if (idleText !== undefined && idleDays === null) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--idle takes a duration such as 3d, 12h or 90m.'
      )
    }
    const repo = getOptionalStringFlag(ctx.flags, 'repo')
    const workspace = getOptionalStringFlag(ctx.flags, 'worktree')
    const params = {
      apply: !ctx.flags.has('dry-run'),
      ...(idleDays !== undefined && idleDays !== null ? { idleDays } : {}),
      ...(repo ? { repo } : {}),
      ...(workspace ? { workspace } : {})
    }
    const result = await ctx.client
      .call<ForkWorktreeReclaimResult>('fork.worktreeReclaim.run', params, {
        timeoutMs: RECLAIM_TIMEOUT_MS
      })
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no worktree reclaim. Update it and try again.'
          )
        }
        throw error
      })
    printResult(result, ctx.json, formatWorktreeReclaim)
  }
}
