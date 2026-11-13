// SLRM-2096 (FORK.md "Lost work"): one row of the Lost work list, with its own actions.
import React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/class-names'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import type { LostWorkItem, LostWorkRisk } from '../../../../shared/fork/lost-work'
import { canOpenLostWork, canPushLostWork, canSaveLostWork } from './lost-work-actions'
import {
  lostWorkKindLabel,
  lostWorkReasons,
  lostWorkRiskLabel,
  lostWorkTitle
} from './lost-work-labels'

export type LostWorkRowAction = 'open' | 'push' | 'pull-request' | 'bundle' | 'patch' | 'delete'

const RISK_CLASS: Record<LostWorkRisk, string> = {
  'would-lose-work': 'border-destructive/50 text-destructive',
  'needs-look': 'border-amber-500/50 text-amber-600 dark:text-amber-400',
  safe: 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
}

// The fields toLocaleDateString() shows by default, in the UI language.
const DAY_FORMAT: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' }

function day(ms: number | null, intlLocale: string): string {
  return ms === null ? '' : uiDateTimeFormat(DAY_FORMAT, intlLocale).format(ms)
}

export function ForkLostWorkRow({
  item,
  selected,
  busy,
  onSelect,
  onAction
}: {
  item: LostWorkItem
  selected: boolean
  busy: boolean
  onSelect: (selected: boolean) => void
  onAction: (action: LostWorkRowAction) => void
}): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const reasons = lostWorkReasons(item)
  const pr = item.pullRequest
  const action = (name: LostWorkRowAction, label: string, enabled = true) => (
    <Button variant="ghost" size="xs" disabled={busy || !enabled} onClick={() => onAction(name)}>
      {label}
    </Button>
  )
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-2 last:border-b-0">
      <Checkbox
        className="mt-1"
        checked={selected}
        disabled={busy}
        onCheckedChange={(checked) => onSelect(checked === true)}
        aria-label={lostWorkTitle(item, t)}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'rounded border px-1.5 py-0.5 text-[11px] font-medium',
              RISK_CLASS[item.risk]
            )}
          >
            {lostWorkRiskLabel(item.risk, t)}
          </span>
          <span className="min-w-0 truncate text-sm font-medium">{lostWorkTitle(item, t)}</span>
          <span className="text-xs text-muted-foreground">{item.repoName}</span>
        </div>
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{lostWorkKindLabel(item.kind)}</span>
          {reasons.map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
          {item.lastCommitAt !== null ? (
            <span>
              {t('fork.lostWork.lastCommit', 'Last commit {{date}}', {
                date: day(item.lastCommitAt, intlLocale)
              })}
            </span>
          ) : null}
          {pr ? <span>{`#${pr.number}`}</span> : null}
        </div>
        {item.path ? (
          <div className="truncate font-mono text-[11px] text-muted-foreground">{item.path}</div>
        ) : null}
        <div className="flex flex-wrap gap-1">
          {canOpenLostWork(item) ? action('open', t('fork.lostWork.open', 'Open')) : null}
          {canPushLostWork(item) ? action('push', t('fork.lostWork.push', 'Push')) : null}
          {canPushLostWork(item)
            ? action(
                'pull-request',
                pr
                  ? t('fork.lostWork.viewPullRequest', 'View pull request')
                  : t('fork.lostWork.createPullRequest', 'Create pull request')
              )
            : null}
          {item.kind !== 'stash'
            ? action('bundle', t('fork.lostWork.saveBundle', 'Save bundle'), canSaveLostWork(item))
            : null}
          {action('patch', t('fork.lostWork.savePatch', 'Save patch'), canSaveLostWork(item))}
          {action('delete', t('fork.lostWork.delete', 'Delete'))}
        </div>
      </div>
    </div>
  )
}
