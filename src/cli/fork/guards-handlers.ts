// Agent guards (FORK.md, SLRM-2385): `orca guards`, through the host's fork.guards.* RPC.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import { agentGuardReasonText, type AgentGuardEntry } from '../../shared/fork/agent-guards'
import type {
  ForkGuardsCapResult,
  ForkGuardsListResult,
  ForkGuardsResumeResult
} from '../../shared/fork/agent-guards-wire'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no guards commands. Update it and try again.'
    )
  }
  throw error
}

function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

function state(entry: AgentGuardEntry, now: number): string {
  if (entry.state === 'capped') {
    return `capped $${(entry.spentUsd ?? 0).toFixed(2)}/$${(entry.capUsd ?? 0).toFixed(2)}`
  }
  const what = `${entry.state} (${entry.reason}) ${ago(now - entry.since)}`
  return entry.notInterrupted ? `${what}, not interrupted` : what
}

export function formatGuardsList(result: ForkGuardsListResult): string {
  if (result.entries.length === 0) {
    return 'No agent is warned, paused or capped.'
  }
  const rows = [
    ['ID', 'AGENT', 'NAME', 'STATE'],
    ...result.entries.map((entry) => [
      entry.id,
      entry.agent,
      entry.title.slice(0, 40),
      state(entry, result.now)
    ])
  ]
  const widths = rows[0].map((_, col) => Math.max(...rows.map((cells) => cells[col].length)))
  const table = rows.map((cells) =>
    cells
      .map((cell, col) => cell.padEnd(widths[col]))
      .join('  ')
      .trimEnd()
  )
  const reasons = result.entries
    .filter((entry) => entry.state !== 'capped')
    .map((entry) => `  ${entry.id}: ${agentGuardReasonText(entry)}`)
  return [...table, ...(reasons.length > 0 ? ['', ...reasons] : [])].join('\n')
}

function requireId(ctx: HandlerContext): string {
  const id = getOptionalStringFlag(ctx.flags, 'id')
  if (!id) {
    throw new RuntimeClientError('invalid_argument', 'Name one: orca guards list shows ids.')
  }
  return id
}

export function parseGuardsUsd(raw: string | undefined): number {
  const usd = raw === undefined ? Number.NaN : Number(raw.trim().replace(/^\$/, ''))
  if (!Number.isFinite(usd) || usd < 0 || usd > 10_000) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Give the cap in USD, from 0 (back to the default) to 10000: orca guards cap <id> <usd>.'
    )
  }
  return usd
}

export const FORK_GUARDS_HANDLERS: Record<string, CommandHandler> = {
  'guards list': async (ctx) => {
    const reply = await ctx.client
      .call<ForkGuardsListResult>('fork.guards.list', {})
      .catch(incompatible)
    printResult(reply, ctx.json, formatGuardsList)
  },
  'guards resume': async (ctx) => {
    const reply = await ctx.client
      .call<ForkGuardsResumeResult>('fork.guards.resume', { id: requireId(ctx) })
      .catch(incompatible)
    printResult(reply, ctx.json, (r) =>
      r.outcome === 'resumed' ? `${r.id}: resumed` : `${r.id}: was not paused`
    )
  },
  'guards cap': async (ctx) => {
    const usd = parseGuardsUsd(getOptionalStringFlag(ctx.flags, 'usd'))
    const reply = await ctx.client
      .call<ForkGuardsCapResult>('fork.guards.cap', { id: requireId(ctx), usd })
      .catch(incompatible)
    printResult(reply, ctx.json, (r) =>
      r.capUsd === null
        ? `${r.id}: follows the default cap again`
        : `${r.id}: capped at $${r.capUsd.toFixed(2)} ($${r.spentUsd.toFixed(2)} spent since)`
    )
  }
}
