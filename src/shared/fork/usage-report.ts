// SLRM-2104 (FORK.md "Usage and cost report"): the usage report's shape, shared by main, the CLI
// and the renderer. Built from the usage ledger (SLRM-2103); costs are estimates.
import { z } from 'zod'
import type { ForkUsagePrice, ForkUsageTokens } from './usage-ledger'

export const FORK_USAGE_REPORT_GROUPS = ['chat', 'coordinator', 'workspace', 'day', 'card'] as const
export type ForkUsageReportGroup = (typeof FORK_USAGE_REPORT_GROUPS)[number]

export const ForkUsageReportParams = z.object({
  by: z.enum(FORK_USAGE_REPORT_GROUPS).optional(),
  /** The last N local days, today included; absent means everything kept. */
  days: z.number().int().min(1).max(3650).optional()
})
export type ForkUsageReportParams = z.infer<typeof ForkUsageReportParams>

export type ForkUsageReportRow = {
  key: string
  label: string
  /** A second line: the workspace of a chat, or the chats a coordinator dispatched. */
  detail?: string
  chats: number
  calls: number
  tokens: Omit<ForkUsageTokens, 'longContext'>
  totalTokens: number
  /** Estimated USD of the per-token-billed usage that has a price; null when none has. */
  costUsd: number | null
  /** Tokens of subscription chats, which are not billed per token. */
  subscriptionTokens: number
  /** Per-token-billed tokens of models with no price in the table. */
  unpricedTokens: number
  lastAt: number
}

export type ForkUsageReport = {
  by: ForkUsageReportGroup
  days: number | null
  generatedAt: number
  rows: ForkUsageReportRow[]
  total: ForkUsageReportRow
  /** Set when the card pattern setting is not a valid regular expression. */
  cardPatternError?: string
}

/** window.api.forkUsageLedger's report side; desktop only. */
export type ForkUsageReportApi = {
  report: (params: ForkUsageReportParams) => Promise<ForkUsageReport>
  clear: () => Promise<void>
  defaultPrices: () => Promise<Record<string, ForkUsagePrice>>
}

/** USD for display: under a cent shows as "<$0.01", larger amounts with two decimals. */
export function formatForkUsd(usd: number | null): string {
  if (usd === null) {
    return '-'
  }
  if (usd > 0 && usd < 0.01) {
    return '<$0.01'
  }
  return `$${usd.toFixed(2)}`
}
