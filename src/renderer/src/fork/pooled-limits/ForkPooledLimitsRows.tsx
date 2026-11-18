// Pooled limits (FORK.md, SLRM-2392): one row per provider in the usage roster's own style (the
// provider icon box, the name line, then small labelled bars), with the pooled 5-hour and weekly
// windows and when the next reset frees how much. The dialog also lists each account.
import React from 'react'
import { useIntlLocale, useTranslate, type Translate } from '@/i18n/use-translate'
import type { UsagePercentageDisplay } from '../../../../shared/agent-usage/display/usage-percentage-display'
import { ProviderIcon } from '@/components/status-bar/usage/provider-usage-panel'
import { UsageBar, UsageValue } from '@/components/status-bar/usage/usage-meter'
import { formatLocalizedResetDuration } from '@/components/status-bar/usage/usage-reset-caption'
import type {
  PooledAccountWindow,
  PooledLimitWindow,
  PooledLimitsProviderRow
} from '../../../../shared/fork/pooled-limits'

const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } as const

function windowLabel(kind: PooledLimitWindow['kind'], t: Translate): string {
  return kind === 'session'
    ? t('fork.pooledLimits.session', '5h')
    : t('fork.pooledLimits.weekly', 'wk')
}

function Metric({
  label,
  usedPercent,
  display
}: {
  label: string
  usedPercent: number
  display: UsagePercentageDisplay
}): React.JSX.Element {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <UsageBar usedPercent={usedPercent} display={display} className="h-[5px] w-7" />
      <UsageValue usedPercent={usedPercent} display={display} className="text-[11px]" />
    </span>
  )
}

function resetCaption(
  window: PooledLimitWindow,
  now: number,
  locale: string,
  t: Translate
): string | null {
  if (window.nextResetAt === null) {
    return null
  }
  const label = windowLabel(window.kind, t)
  const duration =
    formatLocalizedResetDuration(window.nextResetAt, now, locale) ??
    t('fork.pooledLimits.now', 'now')
  return t('fork.pooledLimits.nextReset', '{{window}} resets in {{duration}}, frees {{percent}}%', {
    window: label,
    duration,
    percent: Math.round(window.freesPercent)
  })
}

function AccountMetric({
  label,
  window,
  display
}: {
  label: string
  window: PooledAccountWindow | null
  display: UsagePercentageDisplay
}): React.JSX.Element {
  if (!window) {
    return <span className="text-[10px] text-muted-foreground">{`${label} -`}</span>
  }
  return <Metric label={label} usedPercent={window.usedPercent} display={display} />
}

export function ForkPooledLimitsRow({
  row,
  display,
  now,
  detailed
}: {
  row: PooledLimitsProviderRow
  display: UsagePercentageDisplay
  now: number
  detailed: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const locale = useIntlLocale()
  const captions = row.windows
    .map((window) => resetCaption(window, now, locale, t))
    .filter((caption): caption is string => caption !== null)
  return (
    <div
      data-fork-pooled-provider={row.provider}
      className="flex min-w-0 flex-1 flex-col gap-1 px-3.5 py-2.5"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
          <ProviderIcon provider={row.provider} />
        </span>
        <span className="min-w-0 shrink truncate text-[13px] font-medium text-foreground">
          {PROVIDER_NAMES[row.provider]}
          <span className="font-normal text-muted-foreground">
            {' · '}
            {t('fork.pooledLimits.accounts', '{{count}} accounts pooled', {
              count: row.accounts.length
            })}
          </span>
        </span>
      </div>
      {row.windows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[30px]">
          {row.windows.map((window) => (
            <Metric
              key={window.kind}
              label={windowLabel(window.kind, t)}
              usedPercent={window.usedPercent}
              display={display}
            />
          ))}
        </div>
      ) : (
        <span className="pl-[30px] text-[11px] text-muted-foreground">
          {t('fork.pooledLimits.notRead', 'Not checked')}
        </span>
      )}
      {captions.map((caption) => (
        <span key={caption} className="pl-[30px] text-[11px] text-muted-foreground">
          {caption}
        </span>
      ))}
      {detailed
        ? row.accounts.map((account, index) => (
            <div
              // Two accounts can share a label (one email in two orgs); the order is stable.
              key={index}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[30px]"
            >
              <span className="min-w-0 max-w-[45%] truncate text-[11px] text-foreground">
                {account.label}
              </span>
              <AccountMetric
                label={windowLabel('session', t)}
                window={account.session}
                display={display}
              />
              <AccountMetric
                label={windowLabel('weekly', t)}
                window={account.weekly}
                display={display}
              />
              <span className="truncate text-[10px] text-muted-foreground">
                {account.machines.join(', ')}
              </span>
            </div>
          ))
        : null}
    </div>
  )
}
