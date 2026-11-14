// SLRM-2096 (FORK.md "Lost work"): one row of the Lost work list, with its own actions.
import React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/class-names'
import { useIntlLocale, useTranslate, type Translate } from '@/i18n/use-translate'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import type { LostWorkItem, LostWorkRisk } from '../../../../shared/fork/lost-work'
import {
  canSaveLostWork,
  lostWorkRowActions,
  suggestLostWorkAction,
  type LostWorkRowAction
} from './lost-work-row-actions'
import {
  lostWorkKindLabel,
  lostWorkReasons,
  lostWorkRiskLabel,
  lostWorkTitle,
  lostWorkUseLabel
} from './lost-work-labels'

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

function actionLabel(action: LostWorkRowAction, item: LostWorkItem, t: Translate): string {
  switch (action) {
    case 'open':
      return t('fork.lostWork.open', 'Open')
    case 'push':
      return t('fork.lostWork.push', 'Push')
    case 'pull-request':
      return item.pullRequest
        ? t('fork.lostWork.viewPullRequest', 'View pull request')
        : t('fork.lostWork.createPullRequest', 'Create pull request')
    case 'bundle':
      return t('fork.lostWork.saveBundle', 'Save bundle')
    case 'patch':
      return t('fork.lostWork.savePatch', 'Save patch')
    case 'delete':
      return t('fork.lostWork.delete', 'Delete')
  }
}

function ForkLostWorkRowView({
  item,
  selected,
  busy,
  onSelect,
  onAction
}: {
  item: LostWorkItem
  selected: boolean
  busy: boolean
  onSelect: (item: LostWorkItem, selected: boolean) => void
  onAction: (item: LostWorkItem, action: LostWorkRowAction) => void
}): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const reasons = lostWorkReasons(item)
  const pr = item.pullRequest
  // SLRM-2230: the suggested next step leads the row; the rest keep their usual order.
  const suggested = suggestLostWorkAction(item)
  const actions = lostWorkRowActions(item)
  const ordered = actions.includes(suggested)
    ? [suggested, ...actions.filter((action) => action !== suggested)]
    : actions
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-2 last:border-b-0">
      <Checkbox
        className="mt-1"
        checked={selected}
        disabled={busy}
        onCheckedChange={(checked) => onSelect(item, checked === true)}
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
        </div>
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{lostWorkKindLabel(item.kind)}</span>
          {item.inUse ? (
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {lostWorkUseLabel(item.inUse, t)}
            </span>
          ) : null}
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
          {ordered.map((action) => (
            <Button
              key={action}
              variant={action === suggested ? 'secondary' : 'ghost'}
              size="xs"
              disabled={
                busy || ((action === 'bundle' || action === 'patch') && !canSaveLostWork(item))
              }
              onClick={() => onAction(item, action)}
            >
              {actionLabel(action, item, t)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export const ForkLostWorkRow = React.memo(ForkLostWorkRowView)
