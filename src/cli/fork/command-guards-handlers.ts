// Command guards (FORK.md, BAD-686): `orca command-guards`, through the host's fork.commandGuards.*
// RPC.
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import type { CommandGuardAuditEntry } from '../../shared/fork/command-guards'
import type { CommandGuardAgentLine } from '../../shared/fork/command-guards-agent-line'
import type {
  ForkCommandGuardsAllowResult,
  ForkCommandGuardsListResult,
  ForkCommandGuardsStatusResult
} from '../../shared/fork/command-guards-wire'

function incompatible(error: unknown): never {
  if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This Orca host has no command guards. Update it and try again.'
    )
  }
  throw error
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

const oneLine = (text: string): string => text.replace(/\s+/g, ' ')

function blockText(entry: CommandGuardAuditEntry): string[] {
  return [
    `${new Date(entry.at).toISOString().slice(0, 19).replace('T', ' ')}  ${entry.agent}${entry.surface ? ` (${entry.surface})` : ''}  ${entry.outcome === 'allowed' ? 'ALLOWED ' : ''}${entry.rule}`,
    `  ${oneLine(entry.reason)}`,
    `  $ ${oneLine(entry.command).slice(0, 200)}`
  ]
}

export function formatCommandGuardsList(result: ForkCommandGuardsListResult): string {
  return result.entries.length === 0
    ? 'No command has been blocked.'
    : result.entries.flatMap(blockText).join('\n')
}

export function formatCommandGuardsStatus(result: ForkCommandGuardsStatusResult): string {
  const rules = table([
    ['RULE', 'STATE', 'BLOCKS'],
    ...result.rules.map((row) => [
      row.rule,
      row.offEverywhere
        ? 'allowed everywhere'
        : row.allowedIn.length > 0
          ? `allowed in ${row.allowedIn.join(', ')}`
          : 'on',
      row.summary
    ])
  ])
  const agents = table([
    ['AGENT', 'GUARDED', 'NOTE'],
    ...result.agents.map((row) => [row.agent, row.guarded ? 'yes' : 'no', row.note])
  ])
  const surfaces = table([
    ['CLAUDE SURFACE', 'GUARDED', 'NOTE'],
    ...(result.surfaces ?? []).map((row) => [row.surface, row.guarded ? 'yes' : 'no', row.note])
  ])
  return [
    result.enabled ? 'Command guards are on.' : 'Command guards are off (forkCommandGuards).',
    '',
    ...rules,
    '',
    ...(result.surfaces ? [...surfaces, ''] : []),
    ...agents
  ].join('\n')
}

/** The guard line under an `orca agent list|show` row; none when the host sent none. */
export function forkCommandGuardRowLines(row: { commandGuard?: CommandGuardAgentLine }): string[] {
  const line = row.commandGuard
  if (!line) {
    return []
  }
  return [
    `  command guard: ${line.guarded ? `guarded (${oneLine(line.note)})` : oneLine(line.note)}`
  ]
}

function requireRule(ctx: HandlerContext): string {
  const rule = getOptionalStringFlag(ctx.flags, 'rule')
  if (!rule) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Name a rule: orca command-guards status lists them.'
    )
  }
  return rule
}

function setAllow(allowed: boolean): CommandHandler {
  return async (ctx) => {
    const project = getOptionalStringFlag(ctx.flags, 'project')
    const reply = await ctx.client
      .call<ForkCommandGuardsAllowResult>('fork.commandGuards.allow', {
        rule: requireRule(ctx),
        ...(project ? { project } : {}),
        allowed
      })
      .catch(incompatible)
    printResult(
      reply,
      ctx.json,
      (r) =>
        `${r.rule}: ${r.allowed ? 'allowed' : 'on'} ${r.project ? `in ${r.project}` : 'everywhere'}`
    )
  }
}

export const FORK_COMMAND_GUARDS_HANDLERS: Record<string, CommandHandler> = {
  'command-guards list': async (ctx) => {
    const reply = await ctx.client
      .call<ForkCommandGuardsListResult>('fork.commandGuards.list', {})
      .catch(incompatible)
    printResult(reply, ctx.json, formatCommandGuardsList)
  },
  'command-guards status': async (ctx) => {
    const reply = await ctx.client
      .call<ForkCommandGuardsStatusResult>('fork.commandGuards.status', {})
      .catch(incompatible)
    printResult(reply, ctx.json, formatCommandGuardsStatus)
  },
  'command-guards allow': setAllow(true),
  'command-guards disallow': setAllow(false)
}
