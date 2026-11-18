// Keep main current (SLRM-2384, FORK.md): `orca main-sync`, through the host's fork.mainSync.* RPC.
import type { CommandHandler } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  FORK_MAIN_SYNC_RUN_METHOD,
  FORK_MAIN_SYNC_STATUS_METHOD,
  type ForkMainSyncRepoResult,
  type ForkMainSyncStatus
} from '../../shared/fork/main-sync'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no keep main current. It needs a Blackfish build with SLRM-2384.'
    )
  }
  throw error
}

function when(at: number | null): string {
  return at === null ? '-' : new Date(at).toISOString().slice(0, 16).replace('T', ' ')
}

function what(result: ForkMainSyncRepoResult): string {
  if (result.outcome === 'updated') {
    return `${result.reason} ${result.from ?? '?'}..${result.to ?? '?'}`
  }
  return result.detail ? `${result.reason}: ${result.detail}` : result.reason
}

export function formatMainSyncResults(results: readonly ForkMainSyncRepoResult[]): string[] {
  if (results.length === 0) {
    return ['No project has been looked at yet.']
  }
  const rows = [
    ['PROJECT', 'BRANCH', 'OUTCOME', 'WHEN', 'DETAIL'],
    ...results.map((result) => [
      result.name.length > 32 ? `${result.name.slice(0, 29)}...` : result.name,
      result.remoteRef ? `${result.branch ?? '?'} <- ${result.remoteRef}` : (result.branch ?? '-'),
      result.outcome,
      when(result.at),
      what(result)
    ])
  ]
  const widths = rows[0].map((_, col) => Math.max(...rows.map((cells) => cells[col].length)))
  return rows.map((cells) =>
    cells
      .map((cell, col) => (col === cells.length - 1 ? cell : cell.padEnd(widths[col])))
      .join('  ')
      .trimEnd()
  )
}

export function formatMainSyncStatus(status: ForkMainSyncStatus): string {
  const projects =
    status.projects.length === 0 ? 'every local git project' : status.projects.join(', ')
  const head = status.enabled
    ? `Keep main current is on: every ${status.intervalMinutes} min over ${projects}${status.skipInUse ? ', skipping checkouts in use' : ''}.`
    : 'Keep main current is off on this host (forkMainSync).'
  const times = `Last pass: ${when(status.lastRunAt)}${status.running ? ' (running now)' : ''}. Next: ${when(status.nextRunAt)}.`
  return [head, times, ...formatMainSyncResults(status.results)].join('\n')
}

export const FORK_MAIN_SYNC_HANDLERS: Record<string, CommandHandler> = {
  'main-sync': async (ctx) => {
    const result = await ctx.client
      .call<ForkMainSyncStatus>(FORK_MAIN_SYNC_STATUS_METHOD, {})
      .catch(incompatible)
    printResult(result, ctx.json, formatMainSyncStatus)
  },
  'main-sync run': async (ctx) => {
    const repo = getOptionalStringFlag(ctx.flags, 'repo')
    const result = await ctx.client
      .call<{ results: ForkMainSyncRepoResult[] }>(FORK_MAIN_SYNC_RUN_METHOD, repo ? { repo } : {})
      .catch(incompatible)
    printResult(result, ctx.json, (value) =>
      value.results.length === 0
        ? repo
          ? `No local git project named ${JSON.stringify(repo)} on this host.`
          : 'No local git project to keep current on this host.'
        : formatMainSyncResults(value.results).join('\n')
    )
  }
}
