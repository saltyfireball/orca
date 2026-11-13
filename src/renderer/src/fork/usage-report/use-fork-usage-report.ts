// SLRM-2104 (FORK.md "Usage and cost report"): the dialog's data. Loads the report for the chosen
// grouping and range from main, again on demand, and clears the history.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ForkUsageReport, ForkUsageReportGroup } from '../../../../shared/fork/usage-report'

let open = false
const listeners = new Set<() => void>()

function setOpen(next: boolean): void {
  open = next
  for (const listener of listeners) {
    listener()
  }
}

/** Shows the usage report; the dialog is mounted once at the app root. */
export function openForkUsageReport(): void {
  setOpen(true)
}

export function closeForkUsageReport(): void {
  setOpen(false)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useForkUsageReportOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open)
}

/** Range choices in days; null is everything the ledger keeps. */
export const FORK_USAGE_RANGES = [1, 7, 30, null] as const
export type ForkUsageRange = (typeof FORK_USAGE_RANGES)[number]

type ReportSetters = {
  setReport: (report: ForkUsageReport) => void
  setError: (error: string | null) => void
  setLoading: (loading: boolean) => void
}

/** One load of the report into the hook's state; kept out of the hook so the compiler can compile it. */
async function loadForkUsageReport(
  by: ForkUsageReportGroup,
  days: ForkUsageRange,
  { setReport, setError, setLoading }: ReportSetters
): Promise<void> {
  const api = window.api?.forkUsageLedger
  if (!api) {
    setError('unavailable')
    return
  }
  setLoading(true)
  try {
    setReport(await api.report({ by, ...(days === null ? {} : { days }) }))
    setError(null)
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : String(caught))
  } finally {
    setLoading(false)
  }
}

export function useForkUsageReport(by: ForkUsageReportGroup, days: ForkUsageRange) {
  const [report, setReport] = useState<ForkUsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(
    () => loadForkUsageReport(by, days, { setReport, setError, setLoading }),
    [by, days]
  )
  useEffect(() => {
    void load()
  }, [load])
  const clear = useCallback(async () => {
    await window.api?.forkUsageLedger?.clear()
    await load()
  }, [load])
  return { report, error, loading, reload: load, clear }
}
