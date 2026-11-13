// Fork launch defaults (FORK.md "Launch defaults"): `orca launch-defaults`, through the host's
// fork.launchDefaults.show RPC.
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import type {
  ForkLaunchDefaultsReport,
  ForkLaunchDefaultsRow
} from '../../shared/fork/launch-defaults/launch-defaults-report'

function sourceText(row: ForkLaunchDefaultsRow): string {
  if (row.source === 'fork-default') {
    return 'launch default'
  }
  return row.model ? 'app default (Settings > Agents)' : 'agent config'
}

export function formatForkLaunchDefaults(report: ForkLaunchDefaultsReport): string {
  const agents = new Set(report.rows.filter((row) => row.model).map((row) => row.agent))
  const shown = report.rows.filter((row) => agents.has(row.agent))
  const lines: string[] = []
  if (shown.length === 0) {
    lines.push('No launch defaults set: every launch runs the model from the agent config.')
  } else {
    const table = [
      ['AGENT', 'KIND', 'MODEL', 'EFFORT', 'FROM'],
      ...shown.map((row) => [
        row.agent,
        row.kind,
        row.model ?? '-',
        row.effort ?? '-',
        sourceText(row)
      ])
    ]
    const widths = table[0].map((_, col) => Math.max(...table.map((row) => row[col].length)))
    for (const row of table) {
      lines.push(
        row
          .map((cell, col) => (col === row.length - 1 ? cell : cell.padEnd(widths[col])))
          .join('  ')
      )
    }
  }
  for (const row of report.rows) {
    if (row.note) {
      lines.push(`Note: ${row.agent} ${row.kind}: ${row.note}`)
    }
  }
  return lines.join('\n')
}

export const FORK_LAUNCH_DEFAULTS_HANDLERS: Record<string, CommandHandler> = {
  'launch-defaults': async (ctx) => {
    const agent = getOptionalStringFlag(ctx.flags, 'agent')
    const result = await ctx.client
      .call<ForkLaunchDefaultsReport>('fork.launchDefaults.show')
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no launch defaults. Update Orca on the execution host and try again.'
          )
        }
        throw error
      })
    const report = agent
      ? { ...result.result, rows: result.result.rows.filter((row) => row.agent === agent) }
      : result.result
    printResult({ ...result, result: report }, ctx.json, formatForkLaunchDefaults)
  }
}
