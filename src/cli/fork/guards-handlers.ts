// Agent guards (FORK.md, SLRM-2385): `orca guards`, through the host's fork.guards.* RPC.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import { agentGuardReasonText, type AgentGuardEntry } from '../../shared/fork/agent-guards'
import type {
  ForkGuardsAutomationCapResult,
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

const money = (usd: number): string => `$${usd.toFixed(2)}`

/** `chat $1.00/$5.00, run $12.00/$20.00`: every cap that covers the agent with its spend. */
function limitsText(entry: AgentGuardEntry): string {
  const limits = entry.limits ?? []
  return limits.length > 0
    ? limits
        .map((limit) => `${limit.scope} ${money(limit.spentUsd)}/${money(limit.capUsd)}`)
        .join(', ')
    : `chat ${money(entry.spentUsd ?? 0)}/${money(entry.capUsd ?? 0)}`
}

function state(entry: AgentGuardEntry, now: number): string {
  if (entry.state === 'capped') {
    return `capped ${limitsText(entry)}`
  }
  const what = `${entry.state} (${entry.reason}) ${ago(now - entry.since)}`
  return entry.notInterrupted ? `${what}, not interrupted` : what
}

function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((cells) => cells[col].length)))
  return rows.map((cells) =>
    cells
      .map((cell, col) => cell.padEnd(widths[col]))
      .join('  ')
      .trimEnd()
  )
}

/** The cap of a kind and its spend, or a dash for none. */
function windowCell(cap: number, spent: number | null): string {
  if (cap <= 0) {
    return '-'
  }
  return spent === null ? money(cap) : `${money(spent)}/${money(cap)}`
}

function formatCapSections(result: ForkGuardsListResult): string[] {
  const sections: string[] = []
  if ((result.runs ?? []).length > 0) {
    sections.push(
      '',
      ...table([
        ['RUN', 'NAME', 'AGENTS', 'SPEND'],
        ...(result.runs ?? []).map((run) => [
          run.rootId,
          run.title.slice(0, 40),
          run.uncounted ? `${run.agents} (${run.uncounted} not counted)` : String(run.agents),
          `${money(run.spentUsd)}/${money(run.capUsd)}`
        ])
      ])
    )
  }
  if ((result.automations ?? []).length > 0) {
    sections.push(
      '',
      ...table([
        ['AUTOMATION', 'NAME', 'PER RUN', 'TODAY', '7 DAYS', ''],
        ...(result.automations ?? []).map((row) => [
          row.id,
          row.name.slice(0, 40),
          windowCell(row.runCapUsd, null),
          windowCell(row.dayCapUsd, row.daySpentUsd),
          windowCell(row.weekCapUsd, row.weekSpentUsd),
          row.skipping ? 'skipping runs' : ''
        ])
      ])
    )
  }
  if (sections.length > 0 || hasSpendCap(result)) {
    sections.push('', NOT_COUNTED_NOTE)
  }
  return sections
}

/** BAD-766: what no cap can see, said under every list that shows a cap. */
export const NOT_COUNTED_NOTE =
  'Not counted: agents with no usage record (OpenCode, ACP, Pi and other agents), terminals on SSH or WSL hosts, and agents on paired servers (ask a server with --environment). A Run lists how many of its agents are not counted.'

function hasSpendCap(result: ForkGuardsListResult): boolean {
  return result.entries.some((entry) => entry.state === 'capped')
}

export function formatGuardsList(result: ForkGuardsListResult): string {
  const sections = formatCapSections(result)
  if (result.entries.length === 0) {
    return ['No agent is warned, paused or capped.', ...sections].join('\n')
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
  const reasons = result.entries
    .filter((entry) => entry.state !== 'capped')
    .map((entry) => `  ${entry.id}: ${agentGuardReasonText(entry)}`)
  return [...table(rows), ...(reasons.length > 0 ? ['', ...reasons] : []), ...sections].join('\n')
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

/** A cap flag: a USD amount from 0, or `default` to follow the setting; undefined when not given. */
export function parseAutomationCapFlag(
  raw: string | undefined,
  flag: string
): number | null | undefined {
  if (raw === undefined) {
    return undefined
  }
  if (raw.trim().toLowerCase() === 'default') {
    return null
  }
  const usd = Number(raw.trim().replace(/^\$/, ''))
  if (!Number.isFinite(usd) || usd < 0 || usd > 10_000) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--${flag} takes USD from 0 (no cap) to 10000, or "default".`
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
      .call<ForkGuardsResumeResult>('fork.guards.resume', {
        id: requireId(ctx)
      })
      .catch(incompatible)
    printResult(reply, ctx.json, (r) =>
      r.outcome === 'resumed' ? `${r.id}: resumed` : `${r.id}: was not paused`
    )
  },
  'guards cap': async (ctx) => {
    const usd = parseGuardsUsd(getOptionalStringFlag(ctx.flags, 'usd'))
    const reply = await ctx.client
      .call<ForkGuardsCapResult>('fork.guards.cap', {
        id: requireId(ctx),
        usd,
        ...(ctx.flags.get('run') === true ? { run: true } : {})
      })
      .catch(incompatible)
    printResult(reply, ctx.json, (r) => {
      const what = r.scope === 'run' ? `Run ${r.id}` : r.id
      return r.capUsd === null
        ? `${what}: follows the default cap again`
        : `${what}: capped at $${r.capUsd.toFixed(2)} ($${r.spentUsd.toFixed(2)} spent since)`
    })
  },
  'guards automation-cap': async (ctx) => {
    const flag = (name: string) =>
      parseAutomationCapFlag(getOptionalStringFlag(ctx.flags, name), name)
    const run = flag('per-run')
    const day = flag('day')
    const week = flag('week')
    if (run === undefined && day === undefined && week === undefined) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Give at least one of --per-run, --day or --week.'
      )
    }
    const reply = await ctx.client
      .call<ForkGuardsAutomationCapResult>('fork.guards.automationCap', {
        id: requireId(ctx),
        ...(run !== undefined ? { run } : {}),
        ...(day !== undefined ? { day } : {}),
        ...(week !== undefined ? { week } : {})
      })
      .catch(incompatible)
    const cap = (usd: number): string => (usd > 0 ? `$${usd.toFixed(2)}` : 'none')
    printResult(
      reply,
      ctx.json,
      (r) =>
        `${r.id}: per run ${cap(r.runCapUsd)}, per day ${cap(r.dayCapUsd)}, per 7 days ${cap(r.weekCapUsd)}`
    )
  }
}
