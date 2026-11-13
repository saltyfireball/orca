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
import { translate } from '@/i18n/i18n'
import { LOST_WORK_RISK_ORDER, type LostWorkRisk } from '../../../../shared/fork/lost-work'
import { canPushLostWork, canSaveLostWork } from './lost-work-actions'
import { lostWorkNoteLabel, lostWorkRiskLabel, lostWorkTitle } from './lost-work-labels'
import { ForkLostWorkRow } from './ForkLostWorkRow'
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
  const losing = pending.items.filter((item) => item.risk === 'would-lose-work')
  const second = pending.stage === 2
  return (
    <div className="space-y-2 border-b border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
      <p>
        {second
          ? translate(
              'fork.lostWork.confirmLoss',
              '{{count}} of these hold work that exists nowhere else. Deleting them loses it for good.',
              { count: losing.length }
            )
          : translate('fork.lostWork.confirmDelete', 'Delete {{count}} items?', {
              count: pending.items.length
            })}
      </p>
      {second ? (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {losing.slice(0, 8).map((item) => (
            <li key={item.id}>{`${item.repoName}: ${lostWorkTitle(item)}`}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
          {second
            ? translate('fork.lostWork.confirmLossButton', 'Delete and lose the work')
            : translate('fork.lostWork.confirmDeleteButton', 'Delete')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {translate('fork.lostWork.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
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
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-0 p-0">
        {open ? <DialogBody /> : null}
      </DialogContent>
    </Dialog>
  )
}

function DialogBody(): React.JSX.Element {
  const state = useForkLostWork()
  const { result, scanning, busy, selected, setSelected, pendingDelete } = state
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
        <DialogTitle className="text-base">
          {translate('fork.lostWork.title', 'Lost work')}
        </DialogTitle>
        <DialogDescription>
          {translate(
            'fork.lostWork.description',
            'Unmerged commits, finished branches, worktrees Orca does not track, missing folders and stashes across your local projects. The scan only reads; nothing changes until you act.'
          )}
        </DialogDescription>
        <div className="flex flex-wrap items-center gap-2">
          {scanning ? (
            <Button size="sm" variant="outline" onClick={state.cancel}>
              {translate('fork.lostWork.stopScan', 'Stop scan')}
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => void state.scan()}>
              {result
                ? translate('fork.lostWork.rescan', 'Scan again')
                : translate('fork.lostWork.scan', 'Scan')}
            </Button>
          )}
          {scanning ? (
            <span className="text-xs text-muted-foreground">
              {translate('fork.lostWork.scanning', 'Scanning...')}
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
                  ? translate('fork.lostWork.filterAll', 'All')
                  : lostWorkRiskLabel(value)}
              </Button>
            ))}
          </div>
        </div>
        {chosen.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">
              {translate('fork.lostWork.selected', '{{count}} selected', { count: chosen.length })}
            </span>
            <Button
              size="xs"
              variant="outline"
              disabled={busy || !chosen.some(canPushLostWork)}
              onClick={() => void state.push(chosen.filter(canPushLostWork))}
            >
              {translate('fork.lostWork.push', 'Push')}
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
              {translate('fork.lostWork.saveBundle', 'Save bundle')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void state.save(chosen.filter(canSaveLostWork), 'save-patch')}
            >
              {translate('fork.lostWork.savePatch', 'Save patch')}
            </Button>
            <Button
              size="xs"
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={() => state.setPendingDelete({ items: chosen, stage: 1 })}
            >
              {translate('fork.lostWork.delete', 'Delete')}
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
        {result && items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {translate('fork.lostWork.empty', 'No lost work found.')}
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
                {`${note.repoName}: ${lostWorkNoteLabel(note)}`}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </>
  )
}
