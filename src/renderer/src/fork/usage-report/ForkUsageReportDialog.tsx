// SLRM-2104 (FORK.md "Usage and cost report"): tokens and estimated cost of native Claude chats,
// per chat, coordinator, workspace, day or card. Mounted once at the app root; opened from the
// command palette and from Settings > Advanced > Usage report.
import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatForkTokens } from '../../../../shared/fork/usage-ledger'
import {
  FORK_USAGE_REPORT_GROUPS,
  formatForkUsd,
  type ForkUsageReportGroup,
  type ForkUsageReportRow
} from '../../../../shared/fork/usage-report'
import {
  closeForkUsageReport,
  FORK_USAGE_RANGES,
  useForkUsageReport,
  useForkUsageReportOpen,
  type ForkUsageRange
} from './use-fork-usage-report'

function groupLabel(group: ForkUsageReportGroup): string {
  switch (group) {
    case 'chat':
      return translate('fork.usageReport.byChat', 'Chat')
    case 'coordinator':
      return translate('fork.usageReport.byCoordinator', 'Coordinator')
    case 'workspace':
      return translate('fork.usageReport.byWorkspace', 'Workspace')
    case 'day':
      return translate('fork.usageReport.byDay', 'Day')
    case 'card':
      return translate('fork.usageReport.byCard', 'Card')
  }
}

function rangeLabel(days: ForkUsageRange): string {
  return days === null
    ? translate('fork.usageReport.rangeAll', 'All')
    : translate('fork.usageReport.rangeDays', '{{count}} d', { count: days })
}

/** Cost cell: the estimate, "subscription" when only subscription tokens, "+?" for unpriced. */
function costText(row: ForkUsageReportRow): string {
  if (row.costUsd === null && row.subscriptionTokens > 0 && row.unpricedTokens === 0) {
    return translate('fork.usageReport.subscription', 'subscription')
  }
  return `${formatForkUsd(row.costUsd)}${row.unpricedTokens > 0 ? ' +?' : ''}`
}

function Row({ row, strong }: { row: ForkUsageReportRow; strong?: boolean }): React.JSX.Element {
  const tokens = row.tokens
  const breakdown = translate(
    'fork.usageReport.breakdown',
    'input {{input}}, output {{output}}, cache read {{read}}, cache write {{write}}',
    {
      input: formatForkTokens(tokens.inputTokens),
      output: formatForkTokens(tokens.outputTokens),
      read: formatForkTokens(tokens.cacheReadTokens),
      write: formatForkTokens(tokens.cacheWriteTokens)
    }
  )
  return (
    <tr className={strong ? 'border-t border-border font-medium' : undefined}>
      <td className="max-w-0 py-1 pr-3">
        <div className="truncate">{row.label}</div>
        {row.detail ? (
          <div className="truncate text-xs text-muted-foreground">{row.detail}</div>
        ) : null}
      </td>
      <td className="py-1 pr-3 text-right tabular-nums">{row.chats}</td>
      <td className="py-1 pr-3 text-right tabular-nums" title={breakdown}>
        {formatForkTokens(row.totalTokens)}
      </td>
      <td className="py-1 text-right tabular-nums">{costText(row)}</td>
    </tr>
  )
}

function ClearHistory({ onClear }: { onClear: () => Promise<void> }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        {translate('fork.usageReport.clear', 'Clear history')}
      </Button>
    )
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      {translate('fork.usageReport.clearConfirm', 'Forget all recorded usage?')}
      <Button
        size="sm"
        variant="destructive"
        onClick={() => void onClear().finally(() => setConfirming(false))}
      >
        {translate('fork.usageReport.clearYes', 'Clear')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        {translate('fork.usageReport.cancel', 'Cancel')}
      </Button>
    </span>
  )
}

function DialogBody(): React.JSX.Element {
  const [by, setBy] = useState<ForkUsageReportGroup>('chat')
  const [days, setDays] = useState<ForkUsageRange>(7)
  const { report, error, loading, reload, clear } = useForkUsageReport(by, days)
  const note = (text: string) => <p className="py-6 text-sm text-muted-foreground">{text}</p>
  return (
    <>
      <DialogHeader>
        <DialogTitle>{translate('fork.usageReport.title', 'Usage report')}</DialogTitle>
        <DialogDescription>
          {translate(
            'fork.usageReport.description',
            'Tokens of native Claude chats, sub-agents included. Costs are estimates from the price table in Settings > Advanced > Usage report; chats on a subscription are not billed per token.'
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-1">
        {FORK_USAGE_REPORT_GROUPS.map((group) => (
          <Button
            key={group}
            size="sm"
            variant={group === by ? 'secondary' : 'ghost'}
            onClick={() => setBy(group)}
          >
            {groupLabel(group)}
          </Button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        {FORK_USAGE_RANGES.map((range) => (
          <Button
            key={String(range)}
            size="sm"
            variant={range === days ? 'secondary' : 'ghost'}
            onClick={() => setDays(range)}
          >
            {rangeLabel(range)}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={loading}
          onClick={() => void reload()}
        >
          {translate('fork.usageReport.refresh', 'Refresh')}
        </Button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        {error
          ? note(
              error === 'unavailable'
                ? translate(
                    'fork.usageReport.unavailable',
                    'The usage report needs the desktop app.'
                  )
                : translate('fork.usageReport.failed', 'Could not read usage: {{error}}', { error })
            )
          : null}
        {report?.cardPatternError && by === 'card'
          ? note(
              translate(
                'fork.usageReport.badPattern',
                'The card pattern is not a valid regular expression: {{error}}',
                { error: report.cardPatternError }
              )
            )
          : null}
        {report && report.rows.length === 0 && !error
          ? note(translate('fork.usageReport.empty', 'No usage recorded in this range.'))
          : null}
        {report && report.rows.length > 0 ? (
          <table className="w-full table-fixed text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-normal">{groupLabel(report.by)}</th>
                <th className="w-16 py-1 text-right font-normal">
                  {translate('fork.usageReport.chats', 'Chats')}
                </th>
                <th className="w-20 py-1 text-right font-normal">
                  {translate('fork.usageReport.tokens', 'Tokens')}
                </th>
                <th className="w-28 py-1 text-right font-normal">
                  {translate('fork.usageReport.cost', 'Cost (estimate)')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <Row key={row.key || '-'} row={row} />
              ))}
              <Row
                row={{ ...report.total, label: translate('fork.usageReport.total', 'Total') }}
                strong
              />
            </tbody>
          </table>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1">
          {translate(
            'fork.usageReport.legend',
            '"+?": some tokens are of a model with no price. Hover a token count for its breakdown.'
          )}
        </span>
        <ClearHistory onClear={clear} />
      </div>
    </>
  )
}

export function ForkUsageReportHost(): React.JSX.Element | null {
  const open = useForkUsageReportOpen()
  if (!open || !window.api?.forkUsageLedger) {
    return null
  }
  return (
    <Dialog open onOpenChange={(next) => !next && closeForkUsageReport()}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogBody />
      </DialogContent>
    </Dialog>
  )
}
