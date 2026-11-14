// SLRM-2096 (FORK.md "Lost work"): find unmerged, finished or forgotten work across every local
// project, and keep, push, save or delete it. Opened from the workspace cleanup dialog's header.
import React, { useCallback, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { LOST_WORK_RISK_ORDER, type LostWorkItem } from '../../../../shared/fork/lost-work'
import {
  groupLostWorkByProject,
  lostWorkFilterCounts,
  lostWorkSelectAllState,
  selectableLostWork,
  toggleLostWorkSelectAll,
  type LostWorkFilter
} from './lost-work-bulk'
import { lostWorkFilterHint, lostWorkNoteLabel, lostWorkRiskLabel } from './lost-work-labels'
import { ForkLostWorkBulkButtons } from './ForkLostWorkBulkButtons'
import { ForkLostWorkDeleteConfirm, ForkLostWorkSummary } from './ForkLostWorkConfirm'
import { ForkLostWorkList } from './ForkLostWorkList'
import { lostWorkProgressName, type LostWorkProgressLine } from './lost-work-progress'
import { useForkLostWork } from './use-fork-lost-work'
import { useLostWorkWithUse } from './use-lost-work-use'

const NO_ITEMS: readonly LostWorkItem[] = []

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
  const { result, scanning, progress, busy, selected, setSelected, pendingDelete, summary } = state
  const [filter, setFilter] = useState<LostWorkFilter>('all')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  // SLRM-2230: a workspace in use is marked, and reads as needs-look rather than safe.
  const all = useLostWorkWithUse(result?.items ?? NO_ITEMS)
  const counts = useMemo(() => lostWorkFilterCounts(all), [all])
  const items = useMemo(
    () => (filter === 'all' ? all : all.filter((item) => item.risk === filter)),
    [all, filter]
  )
  const groups = useMemo(() => groupLostWorkByProject(items), [items])
  const chosen = items.filter((item) => selected.has(item.id))
  const select = useCallback(
    (item: LostWorkItem, on: boolean) =>
      setSelected((current) => {
        const next = new Set(current)
        if (on) {
          next.add(item.id)
        } else {
          next.delete(item.id)
        }
        return next
      }),
    [setSelected]
  )
  const toggleAll = useCallback(
    (rows: readonly LostWorkItem[]) =>
      setSelected((current) => toggleLostWorkSelectAll(rows, current)),
    [setSelected]
  )
  const toggleCollapsed = useCallback(
    (repoId: string) =>
      setCollapsed((current) => {
        const next = new Set(current)
        if (!next.delete(repoId)) {
          next.add(repoId)
        }
        return next
      }),
    []
  )
  const safe = filter === 'safe' ? selectableLostWork(items) : NO_ITEMS
  const filters: LostWorkFilter[] = ['all', ...LOST_WORK_RISK_ORDER]
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
                {result ? <span className="text-muted-foreground">{counts[value]}</span> : null}
              </Button>
            ))}
          </div>
        </div>
        {result ? (
          <p className="text-xs text-muted-foreground">{lostWorkFilterHint(filter, t)}</p>
        ) : null}
        {items.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            <label className="mr-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={lostWorkSelectAllState(items, selected)}
                disabled={busy}
                onCheckedChange={() => toggleAll(items)}
                aria-label={t('fork.lostWork.selectAll', 'Select all shown')}
              />
              {chosen.length > 0
                ? t('fork.lostWork.selectedOf', '{{count}} of {{total}} selected', {
                    count: chosen.length,
                    total: items.length
                  })
                : t('fork.lostWork.selectAll', 'Select all shown')}
            </label>
            {chosen.length > 0 ? (
              <ForkLostWorkBulkButtons
                chosen={chosen}
                busy={busy}
                onPush={(rows) => void state.push(rows)}
                onSave={(rows, action) => void state.save(rows, action)}
                onDelete={state.requestDelete}
              />
            ) : null}
            {safe.length > 0 ? (
              <Button
                size="xs"
                variant="outline"
                className="ml-auto text-destructive"
                disabled={busy}
                onClick={() => state.requestDelete(safe)}
              >
                {t('fork.lostWork.deleteAllSafe', 'Delete all {{count}} safe', {
                  count: safe.length
                })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </DialogHeader>
      {pendingDelete ? (
        <ForkLostWorkDeleteConfirm
          pending={pendingDelete}
          busy={busy}
          onConfirm={() => void state.confirmDelete()}
          onCancel={() => state.setPendingDelete(null)}
        />
      ) : null}
      {summary ? (
        <ForkLostWorkSummary summary={summary} onDismiss={() => state.setSummary(null)} />
      ) : null}
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        {result && !scanning && items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {t('fork.lostWork.empty', 'No lost work found.')}
          </p>
        ) : null}
        <ForkLostWorkList
          groups={groups}
          selected={selected}
          collapsed={collapsed}
          busy={busy}
          onToggleCollapsed={toggleCollapsed}
          onToggleGroup={toggleAll}
          onSelect={select}
          onAction={state.rowAction}
        />
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
