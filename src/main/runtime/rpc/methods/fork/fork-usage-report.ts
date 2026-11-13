// SLRM-2104 (FORK.md "Usage and cost report"): `orca usage-report` reads the same report as the
// desktop's Usage report dialog. Only the desktop app keeps the ledger, so a host without it
// says so.
import { defineMethod } from '../../core'
import { ForkUsageReportParams } from '../../../../../shared/fork/usage-report'
import { forkUsageReport } from '../../../../fork/usage-ledger/usage-report-service'

export const FORK_USAGE_REPORT_METHODS = [
  defineMethod({
    name: 'fork.usageLedger.report',
    permission: 'workspace',
    params: ForkUsageReportParams,
    handler: async (params) => forkUsageReport(params)
  })
] as const
