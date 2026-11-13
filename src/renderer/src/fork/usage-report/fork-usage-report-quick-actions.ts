// SLRM-2104 (FORK.md "Usage and cost report"): the command palette entry that opens the usage
// report. Spread into the stock catalog.
import { ChartColumn } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { CmdJQuickAction } from '@/components/cmd-j/quick-actions'
import { openForkUsageReport } from './use-fork-usage-report'

export function getForkUsageReportQuickActions(): CmdJQuickAction[] {
  const title = translate('fork.usageReport.palette', 'Usage report')
  return [
    {
      id: 'fork-usage-report',
      kind: 'action',
      title,
      description: translate(
        'fork.usageReport.paletteDescription',
        'Tokens and estimated cost of Claude chats per chat, coordinator, workspace, day or card'
      ),
      icon: ChartColumn,
      verbKeywords: [
        title,
        translate('fork.usageReport.keywordCost', 'cost'),
        translate('fork.usageReport.keywordTokens', 'tokens'),
        translate('fork.usageReport.keywordSpend', 'spend')
      ],
      isAvailable: () =>
        window.api?.forkUsageLedger
          ? { available: true }
          : { available: false, reason: 'client-action-unsupported' },
      run: async () => {
        openForkUsageReport()
        return { status: 'ok' }
      }
    }
  ]
}
