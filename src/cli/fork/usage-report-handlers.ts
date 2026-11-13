// SLRM-2104 (FORK.md "Usage and cost report"): `orca usage-report`, through the desktop's
// fork.usageLedger.report RPC.
import type { CommandHandler } from '../dispatch'
import { getOptionalPositiveIntegerFlag, getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  FORK_USAGE_REPORT_GROUPS,
  formatForkUsd,
  type ForkUsageReport,
  type ForkUsageReportGroup,
  type ForkUsageReportRow
} from '../../shared/fork/usage-report'
import { formatForkTokens } from '../../shared/fork/usage-ledger'

const HEADING: Record<ForkUsageReportGroup, string> = {
  chat: 'CHAT',
  coordinator: 'COORDINATOR',
  workspace: 'WORKSPACE',
  day: 'DAY',
  card: 'CARD'
}

function readGroup(value: string | undefined): ForkUsageReportGroup | undefined {
  if (value === undefined) {
    return undefined
  }
  const group = FORK_USAGE_REPORT_GROUPS.find((entry) => entry === value)
  if (!group) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--by takes one of: ${FORK_USAGE_REPORT_GROUPS.join(', ')}.`
    )
  }
  return group
}

function costCell(row: ForkUsageReportRow): string {
  if (row.costUsd === null && row.subscriptionTokens > 0 && row.unpricedTokens === 0) {
    return 'subscription'
  }
  const unpriced = row.unpricedTokens > 0 ? '+?' : ''
  return `${formatForkUsd(row.costUsd)}${unpriced}`
}

function line(row: ForkUsageReportRow, labelWidth: number): string {
  const label = row.detail ? `${row.label} (${row.detail})` : row.label
  const cut = label.length > labelWidth ? `${label.slice(0, labelWidth - 3)}...` : label
  return [
    cut.padEnd(labelWidth),
    String(row.chats).padStart(5),
    formatForkTokens(row.totalTokens).padStart(8),
    costCell(row).padStart(13)
  ].join('  ')
}

export function formatUsageReport(report: ForkUsageReport): string {
  const scope = report.days === null ? 'all kept history' : `the last ${report.days} days`
  const lines = [`Usage of native Claude chats over ${scope}.`]
  if (report.cardPatternError) {
    lines.push(`The card pattern is not a valid regular expression: ${report.cardPatternError}`)
  }
  if (report.rows.length === 0) {
    lines.push('No usage recorded.')
    return lines.join('\n')
  }
  const width = 48
  lines.push(
    [HEADING[report.by].padEnd(width), 'CHATS', '  TOKENS', '  COST (EST.)'.padStart(13)].join(
      '  '
    ),
    ...report.rows.map((row) => line(row, width)),
    line(report.total, width)
  )
  lines.push(
    'Costs are estimates from the price table (Settings > Advanced > Usage report).',
    '"subscription": tokens of chats on a subscription, which is not billed per token.',
    '"+?": some tokens are of a model with no price in the table.'
  )
  return lines.join('\n')
}

export const FORK_USAGE_REPORT_HANDLERS: Record<string, CommandHandler> = {
  'usage-report': async (ctx) => {
    const by = readGroup(getOptionalStringFlag(ctx.flags, 'by'))
    const days = getOptionalPositiveIntegerFlag(ctx.flags, 'days')
    const result = await ctx.client
      .call<ForkUsageReport>('fork.usageLedger.report', {
        ...(by ? { by } : {}),
        ...(days ? { days } : {})
      })
      .catch((error: unknown) => {
        if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
          throw new RuntimeClientError(
            'incompatible_runtime',
            'This Orca host has no usage report. It needs a Blackfish build with SLRM-2104.'
          )
        }
        throw error
      })
    printResult(result, ctx.json, formatUsageReport)
  }
}
