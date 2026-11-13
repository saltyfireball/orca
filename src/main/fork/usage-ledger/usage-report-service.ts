// SLRM-2104 (FORK.md "Usage and cost report"): the report from the live ledger and the current
// settings, for the window (IPC) and the CLI (fork.usageLedger.report).
import type { ForkUsageReport, ForkUsageReportParams } from '../../../shared/fork/usage-report'
import { buildUsageReport, cleanUsagePrices, usagePricer } from './usage-report'
import { forkUsageLedgerData, forkUsageLedgerSettings } from './usage-ledger-service'

export function forkUsageReport(
  params: ForkUsageReportParams,
  now: number = Date.now()
): ForkUsageReport {
  const data = forkUsageLedgerData()
  if (!data) {
    throw new Error('The usage ledger runs in the Orca desktop app; open it and try again.')
  }
  const settings = forkUsageLedgerSettings()
  return buildUsageReport(data, {
    by: params.by ?? 'chat',
    ...(params.days ? { days: params.days } : {}),
    now,
    pricer: usagePricer(cleanUsagePrices(settings?.forkUsagePrices)),
    ...(settings?.forkUsageCardPattern ? { cardPattern: settings.forkUsageCardPattern } : {})
  })
}
