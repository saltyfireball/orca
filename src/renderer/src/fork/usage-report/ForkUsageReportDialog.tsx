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
import { useTranslate, type Translate } from '@/i18n/use-translate'
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

function groupLabel(group: ForkUsageReportGroup, t: Translate): string {
  switch (group) {
    case 'chat':
      return t('fork.usageReport.byChat', 'Chat')
    case 'coordinator':
      return t('fork.usageReport.byCoordinator', 'Coordinator')
    case 'workspace':
      return t('fork.usageReport.byWorkspace', 'Workspace')
    case 'day':
      return t('fork.usageReport.byDay', 'Day')
    case 'card':
      return t('fork.usageReport.byCard', 'Card')
  }
}

function rangeLabel(days: ForkUsageRange, t: Translate): string {
  return days === null
    ? t('fork.usageReport.rangeAll', 'All')
    : t('fork.usageReport.rangeDays', '{{count}} d', { count: days })
}

/** Cost cell: the estimate, "subscription" when only subscription tokens, "+?" for unpriced. */
function costText(row: ForkUsageReportRow, t: Translate): string {
  if (row.costUsd === null && row.subscriptionTokens > 0 && row.unpricedTokens === 0) {
    return t('fork.usageReport.subscription', 'subscription')
  }
  return `${formatForkUsd(row.costUsd)}${row.unpricedTokens > 0 ? ' +?' : ''}`
}

function Row({ row, strong }: { row: ForkUsageReportRow; strong?: boolean }): React.JSX.Element {
  const t = useTranslate()
  const tokens = row.tokens
  const breakdown = t(
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
      <td className="py-1 text-right tabular-nums">{costText(row, t)}</td>
    </tr>
  )
}

function ClearHistory({ onClear }: { onClear: () => Promise<void> }): React.JSX.Element {
  const t = useTranslate()
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        {t('fork.usageReport.clear', 'Clear history')}
      </Button>
    )
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      {t('fork.usageReport.clearConfirm', 'Forget all recorded usage?')}
      <Button
        size="sm"
        variant="destructive"
        onClick={() => void onClear().finally(() => setConfirming(false))}
      >
        {t('fork.usageReport.clearYes', 'Clear')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        {t('fork.usageReport.cancel', 'Cancel')}
      </Button>
    </span>
  )
}

function DialogBody(): React.JSX.Element {
  const t = useTranslate()
  const [by, setBy] = useState<ForkUsageReportGroup>('chat')
  const [days, setDays] = useState<ForkUsageRange>(7)
  const { report, error, loading, reload, clear } = useForkUsageReport(by, days)
  const note = (text: string) => <p className="py-6 text-sm text-muted-foreground">{text}</p>
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('fork.usageReport.title', 'Usage report')}</DialogTitle>
        <DialogDescription>
          {t(
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
            {groupLabel(group, t)}
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
            {rangeLabel(range, t)}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={loading}
          onClick={() => void reload()}
        >
          {t('fork.usageReport.refresh', 'Refresh')}
        </Button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        {error
          ? note(
              error === 'unavailable'
                ? t('fork.usageReport.unavailable', 'The usage report needs the desktop app.')
                : t('fork.usageReport.failed', 'Could not read usage: {{error}}', { error })
            )
          : null}
        {report?.cardPatternError && by === 'card'
          ? note(
              t(
                'fork.usageReport.badPattern',
                'The card pattern is not a valid regular expression: {{error}}',
                { error: report.cardPatternError }
              )
            )
          : null}
        {report && report.rows.length === 0 && !error
          ? note(t('fork.usageReport.empty', 'No usage recorded in this range.'))
          : null}
        {report && report.rows.length > 0 ? (
          <table className="w-full table-fixed text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-normal">{groupLabel(report.by, t)}</th>
                <th className="w-16 py-1 text-right font-normal">
                  {t('fork.usageReport.chats', 'Chats')}
                </th>
                <th className="w-20 py-1 text-right font-normal">
                  {t('fork.usageReport.tokens', 'Tokens')}
                </th>
                <th className="w-28 py-1 text-right font-normal">
                  {t('fork.usageReport.cost', 'Cost (estimate)')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <Row key={row.key || '-'} row={row} />
              ))}
              <Row row={{ ...report.total, label: t('fork.usageReport.total', 'Total') }} strong />
            </tbody>
          </table>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1">
          {t(
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
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogBody />
      </DialogContent>
    </Dialog>
  )
}
