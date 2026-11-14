// SLRM-2096 (FORK.md "Lost work"): find unmerged, finished or forgotten work across every local
// project, and keep, push, save or delete it. Opened from the workspace cleanup dialog's header.
import React, { useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { LOST_WORK_RISK_ORDER, type LostWorkRisk } from '../../../../shared/fork/lost-work'
import { canPushLostWork, canSaveLostWork } from './lost-work-actions'
import { lostWorkNoteLabel, lostWorkRiskLabel, lostWorkTitle } from './lost-work-labels'
import { ForkLostWorkRow } from './ForkLostWorkRow'
import { lostWorkProgressName, type LostWorkProgressLine } from './lost-work-progress'
import { useForkLostWork, type LostWorkPendingDelete } from './use-fork-lost-work'

type Filter = 'all' | LostWorkRisk

function DeleteConfirm({
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
  const losing = pending.items.filter((item) => item.risk === 'would-lose-work')
  const second = pending.stage === 2
  return (
    <div className="space-y-2 border-b border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
      <p>
        {second
          ? t(
              'fork.lostWork.confirmLoss',
              '{{count}} of these hold work that exists nowhere else. Deleting them loses it for good.',
              { count: losing.length }
            )
          : t('fork.lostWork.confirmDelete', 'Delete {{count}} items?', {
              count: pending.items.length
            })}
      </p>
      {second ? (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {losing.slice(0, 8).map((item) => (
            <li key={item.id}>{`${item.repoName}: ${lostWorkTitle(item, t)}`}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
          {second
            ? t('fork.lostWork.confirmLossButton', 'Delete and lose the work')
            : t('fork.lostWork.confirmDeleteButton', 'Delete')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('fork.lostWork.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}

/** SLRM-2175: projects done of total, and the one being read. */
function scanProgressText(progress: LostWorkProgressLine | null, t: Translate): string {
  if (!progress || progress.total === 0) {
    return t('fork.lostWork.scanning', 'Scanning...')
  }
  const { done, total } = progress
  const name = lostWorkProgressName(progress.current)
  return name
    ? t(
        'fork.lostWork.progressReading',
        '{{done}} of {{total}} projects scanned. Reading {{name}}',
        {
          done,
          total,
          name
        }
      )
    : t('fork.lostWork.progress', '{{done}} of {{total}} projects scanned', { done, total })
}

export function ForkLostWorkDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        {open ? <DialogBody /> : null}
      </DialogContent>
    </Dialog>
  )
}

function DialogBody(): React.JSX.Element {
  const t = useTranslate()
  const state = useForkLostWork()
  const { result, scanning, progress, busy, selected, setSelected, pendingDelete } = state
  const [filter, setFilter] = useState<Filter>('all')
  const items = useMemo(() => {
    const all = result?.items ?? []
    const shown = filter === 'all' ? all : all.filter((item) => item.risk === filter)
    return [...shown].sort(
      (a, b) =>
        LOST_WORK_RISK_ORDER.indexOf(a.risk) - LOST_WORK_RISK_ORDER.indexOf(b.risk) ||
        a.repoName.localeCompare(b.repoName) ||
        (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0)
    )
  }, [result, filter])
  const chosen = items.filter((item) => selected.has(item.id))
  const select = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  const filters: Filter[] = ['all', ...LOST_WORK_RISK_ORDER]
  return (
    <>
      <DialogHeader className="space-y-2 border-b border-border px-4 py-3">
        <DialogTitle className="text-base">{t('fork.lostWork.title', 'Lost work')}</DialogTitle>
        <DialogDescription>
          {t(
            'fork.lostWork.description',
            'Unmerged commits, finished branches, worktrees Orca does not track, missing folders and stashes across your local projects. The scan only reads; nothing changes until you act.'
          )}
        </DialogDescription>
        <div className="flex flex-wrap items-center gap-2">
          {scanning ? (
            <Button size="sm" variant="outline" onClick={state.cancel}>
              {t('fork.lostWork.stopScan', 'Stop scan')}
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => void state.scan()}>
              {result ? t('fork.lostWork.rescan', 'Scan again') : t('fork.lostWork.scan', 'Scan')}
            </Button>
          )}
          {scanning ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {scanProgressText(progress, t)}
            </span>
          ) : null}
          <div className="ml-auto flex gap-1">
            {filters.map((value) => (
              <Button
                key={value}
                size="xs"
                variant={filter === value ? 'secondary' : 'ghost'}
                onClick={() => setFilter(value)}
              >
                {value === 'all'
                  ? t('fork.lostWork.filterAll', 'All')
                  : lostWorkRiskLabel(value, t)}
              </Button>
            ))}
          </div>
        </div>
        {chosen.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">
              {t('fork.lostWork.selected', '{{count}} selected', { count: chosen.length })}
            </span>
            <Button
              size="xs"
              variant="outline"
              disabled={busy || !chosen.some(canPushLostWork)}
              onClick={() => void state.push(chosen.filter(canPushLostWork))}
            >
              {t('fork.lostWork.push', 'Push')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void state.save(
                  chosen.filter((item) => item.kind !== 'stash' && canSaveLostWork(item)),
                  'save-bundle'
                )
              }
            >
              {t('fork.lostWork.saveBundle', 'Save bundle')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void state.save(chosen.filter(canSaveLostWork), 'save-patch')}
            >
              {t('fork.lostWork.savePatch', 'Save patch')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={() => state.setPendingDelete({ items: chosen, stage: 1 })}
            >
              {t('fork.lostWork.delete', 'Delete')}
            </Button>
          </div>
        ) : null}
      </DialogHeader>
      {pendingDelete ? (
        <DeleteConfirm
          pending={pendingDelete}
          busy={busy}
          onConfirm={() => void state.confirmDelete()}
          onCancel={() => state.setPendingDelete(null)}
        />
      ) : null}
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        {result && !scanning && items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {t('fork.lostWork.empty', 'No lost work found.')}
          </p>
        ) : null}
        {items.map((item) => (
          <ForkLostWorkRow
            key={item.id}
            item={item}
            selected={selected.has(item.id)}
            busy={busy}
            onSelect={(on) => select(item.id, on)}
            onAction={(action) => state.rowAction(item, action)}
          />
        ))}
        {result?.notes.length ? (
          <div className="space-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {result.notes.map((note, index) => (
              <p key={`${note.repoId}-${note.code}-${index}`}>
                {`${note.repoName}: ${lostWorkNoteLabel(note, t)}`}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </>
  )
}
