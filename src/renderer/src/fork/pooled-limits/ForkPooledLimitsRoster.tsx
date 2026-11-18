// Pooled limits (FORK.md, SLRM-2392): the usage popover's pooled section, under the per-provider
// rows of UsageRosterPanel (one hook there). It shows a provider only when two or more of its
// accounts are seen across this machine and its paired servers, since one account is already the
// row above. The /usage-limits dialog shows the same rows with each account.
import React from 'react'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import { useResetCountdownClock } from '@/components/status-bar/usage/useResetCountdownClock'
import type { UsagePercentageDisplay } from '../../../../shared/agent-usage/display/usage-percentage-display'
import type {
  ForkPooledLimitsResult,
  PooledLimitsProviderRow
} from '../../../../shared/fork/pooled-limits'
import { useForkPooledLimits } from './use-fork-pooled-limits'
import { ForkPooledLimitsRow } from './ForkPooledLimitsRows'

export function useForkPooledLimitsEnabled(): boolean {
  return useAppStore((s) => s.settings?.forkPooledLimits !== false)
}

export function forkPooledMachinesAnswered(result: ForkPooledLimitsResult | null): number {
  return result?.machines.filter((machine) => machine.status === 'ok').length ?? 0
}

export function ForkPooledLimitsList({
  rows,
  machines,
  display,
  detailed
}: {
  rows: readonly PooledLimitsProviderRow[]
  machines: number
  display: UsagePercentageDisplay
  detailed: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const now = useResetCountdownClock(
    rows.flatMap((row) => row.windows.map((window) => window.nextResetAt))
  )
  return (
    <div data-fork-pooled-limits>
      <div className="flex min-w-0 items-center gap-1.5 px-3.5 pt-2.5 text-muted-foreground">
        <span className="text-[13px] font-semibold text-foreground">
          {t('fork.pooledLimits.title', 'Pooled')}
        </span>
        <span className="truncate text-[11px]">
          {'· '}
          {t('fork.pooledLimits.machines', 'every account on {{count}} machines', {
            count: machines
          })}
        </span>
      </div>
      {rows.map((row) => (
        <ForkPooledLimitsRow
          key={row.provider}
          row={row}
          display={display}
          now={now}
          detailed={detailed}
        />
      ))}
    </div>
  )
}

/** Mounted inside the usage popover; renders nothing until there is something to pool. */
export function ForkPooledLimitsRoster({
  display
}: {
  display: UsagePercentageDisplay
}): React.JSX.Element | null {
  const enabled = useForkPooledLimitsEnabled()
  const { result } = useForkPooledLimits(enabled)
  if (!enabled || !result || result.off) {
    return null
  }
  const rows = result.providers.filter((row) => row.accounts.length >= 2)
  if (rows.length === 0) {
    return null
  }
  return (
    <>
      <div className="border-t border-border/70" />
      <ForkPooledLimitsList
        rows={rows}
        machines={forkPooledMachinesAnswered(result)}
        display={display}
        detailed={false}
      />
    </>
  )
}
