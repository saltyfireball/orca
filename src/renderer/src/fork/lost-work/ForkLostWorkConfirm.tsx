// SLRM-2096, SLRM-2230 (FORK.md "Lost work"): the bands under the dialog's header: the
// confirmations a delete passes, and what a bulk action did.
import React from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { LostWorkItem } from '../../../../shared/fork/lost-work'
import { lostWorkKindCounts, type LostWorkBulkSummary } from './lost-work-bulk'
import { lostWorkTitle, lostWorkUseLabel } from './lost-work-labels'
import type { LostWorkPendingDelete } from './use-fork-lost-work'

/** "12 workspaces, 3 branches, 2 folders already gone": only the kinds that are there. */
function kindCountsText(items: readonly LostWorkItem[], t: Translate): string {
  const counts = lostWorkKindCounts(items)
  return [
    counts.worktree
      ? t('fork.lostWork.count.workspaces', '{{count}} workspaces', { count: counts.worktree })
      : '',
    counts['untracked-worktree']
      ? t('fork.lostWork.count.untracked', '{{count}} worktrees Orca does not track', {
          count: counts['untracked-worktree']
        })
      : '',
    counts.branch
      ? t('fork.lostWork.count.branches', '{{count}} branches', { count: counts.branch })
      : '',
    counts['missing-folder']
      ? t('fork.lostWork.count.missing', '{{count}} folders already gone', {
          count: counts['missing-folder']
        })
      : '',
    counts.stash
      ? t('fork.lostWork.count.stashes', '{{count}} stashes', { count: counts.stash })
      : ''
  ]
    .filter(Boolean)
    .join(', ')
}

function Names({ lines }: { lines: string[] }): React.JSX.Element {
  return (
    <ul className="scrollbar-sleek max-h-32 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">
      {lines.map((line, index) => (
        <li key={`${index}-${line}`}>{line}</li>
      ))}
    </ul>
  )
}

export function ForkLostWorkDeleteConfirm({
  pending,
  busy,
  onConfirm,
  onCancel
}: {
  pending: LostWorkPendingDelete
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { items, stage } = pending
  const losing = items.filter((item) => item.risk === 'would-lose-work')
  const inUse = items.filter((item) => item.inUse)
  const name = (item: LostWorkItem) => `${item.repoName}: ${lostWorkTitle(item, t)}`
  return (
    <div className="space-y-2 border-b border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
      {stage === 'confirm' ? (
        <p>
          {t('fork.lostWork.confirmDeleteKinds', 'Delete {{count}} items? {{kinds}}.', {
            count: items.length,
            kinds: kindCountsText(items, t)
          })}
        </p>
      ) : null}
      {stage === 'in-use' ? (
        <>
          <p>
            {t(
              'fork.lostWork.confirmInUse',
              '{{count}} of these are in use. Deleting them closes their chats and terminals and stops their agents.',
              { count: inUse.length }
            )}
          </p>
          <Names
            lines={inUse.map((item) =>
              item.inUse ? `${name(item)} - ${lostWorkUseLabel(item.inUse, t)}` : name(item)
            )}
          />
        </>
      ) : null}
      {stage === 'loss' ? (
        <>
          <p>
            {t(
              'fork.lostWork.confirmLoss',
              '{{count}} of these hold work that exists nowhere else. Deleting them loses it for good.',
              { count: losing.length }
            )}
          </p>
          <Names lines={losing.map(name)} />
        </>
      ) : null}
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
          {stage === 'loss'
            ? t('fork.lostWork.confirmLossButton', 'Delete and lose the work')
            : stage === 'in-use'
              ? t('fork.lostWork.confirmInUseButton', 'Delete what is in use too')
              : t('fork.lostWork.confirmDeleteButton', 'Delete')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('fork.lostWork.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}

function summaryText(summary: LostWorkBulkSummary, t: Translate): string {
  const count = summary.done
  const done =
    summary.action === 'delete'
      ? t('fork.lostWork.summary.removed', '{{count}} removed', { count })
      : summary.action === 'push'
        ? t('fork.lostWork.summary.pushed', '{{count}} pushed', { count })
        : t('fork.lostWork.summary.saved', '{{count}} saved in {{files}} files', {
            count,
            files: summary.files.length
          })
  return summary.refused.length > 0
    ? t('fork.lostWork.summary.withRefused', '{{done}}, {{count}} refused:', {
        done,
        count: summary.refused.length
      })
    : `${done}.`
}

/** What the last bulk action did: how many went through, and why each of the others did not. */
export function ForkLostWorkSummary({
  summary,
  onDismiss
}: {
  summary: LostWorkBulkSummary
  onDismiss: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div role="status" className="space-y-2 border-b border-border bg-muted/40 px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1">{summaryText(summary, t)}</p>
        <Button variant="ghost" size="xs" onClick={onDismiss}>
          {t('fork.lostWork.summary.dismiss', 'Dismiss')}
        </Button>
      </div>
      {summary.refused.length > 0 ? (
        <Names lines={summary.refused.map(({ name, reason }) => `${name}: ${reason}`)} />
      ) : null}
    </div>
  )
}
