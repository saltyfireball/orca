// Sleepers (FORK.md): every native chat and terminal agent in one list, with sleep, wake, keep
// awake and close per row and for a selection. Mounted once at the app root; the command palette
// and the sidebar button open it.
import React, { useMemo, useState, useSyncExternalStore } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import {
  filterSleepers,
  selectSleepAllIdle,
  selectSleepExceptVisible,
  sortSleepers,
  type SleeperRow
} from '../../../../shared/fork/sleepers'
import { closeSleeper, setSleeperPinned, sleepSleepers, wakeSleeper } from './sleepers-actions'
import { ForkSleepersRow, type SleeperRowActions } from './ForkSleepersRow'
import { ForkSleepersFilters, type SleepersView } from './ForkSleepersFilters'
import { sleeperBulkTargets, type SleeperBulkAction } from './sleepers-view-model'
import { useSleeperRows } from './use-sleeper-rows'

let open = false
const listeners = new Set<() => void>()

function setOpen(next: boolean): void {
  open = next
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function openForkSleepersDialog(): void {
  setOpen(true)
}

const DEFAULT_VIEW: SleepersView = {
  state: 'all',
  worktreeId: '',
  minIdleMs: 0,
  sort: 'idle',
  descending: true
}

function Body(): React.JSX.Element {
  const t = useTranslate()
  const { rows, now, error, refresh } = useSleeperRows(true)
  const [view, setView] = useState<SleepersView>(DEFAULT_VIEW)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [confirmBulkClose, setConfirmBulkClose] = useState(false)
  const shown = useMemo(
    () =>
      sortSleepers(
        filterSleepers(rows ?? [], {
          states: view.state === 'all' ? undefined : [view.state],
          worktreeId: view.worktreeId || null,
          minIdleMs: view.minIdleMs
        }),
        view.sort,
        view.descending
      ),
    [rows, view]
  )

  const after = (work: unknown): void => {
    void Promise.resolve(work).finally(refresh)
  }
  const sleepRows = (targets: readonly SleeperRow[]): void =>
    after(sleepSleepers(targets.map((row) => row.id)))
  const actions: SleeperRowActions = {
    sleep: (row) => sleepRows([row]),
    wake: (row) => {
      if (wakeSleeper(row)) {
        setOpen(false)
      }
    },
    pin: (row, pinned) => after(setSleeperPinned(row, pinned)),
    close: (row) => after(closeSleeper(row)),
    after
  }
  const bulk = (action: SleeperBulkAction): void => {
    const targets = sleeperBulkTargets(shown, selected, action)
    if (action === 'sleep') {
      sleepRows(targets)
    } else if (action === 'close') {
      targets.forEach((row) => closeSleeper(row))
      refresh()
    } else {
      after(
        targets.reduce<Promise<void>>(
          (chain, row) => chain.then(() => setSleeperPinned(row, action === 'pin')),
          Promise.resolve()
        )
      )
    }
    setSelected(new Set())
  }
  const select = (id: string, on: boolean): void => {
    const next = new Set(selected)
    if (on) {
      next.add(id)
    } else {
      next.delete(id)
    }
    setSelected(next)
  }
  const count = (action: SleeperBulkAction) => sleeperBulkTargets(shown, selected, action).length

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => sleepRows(selectSleepAllIdle(rows ?? []))}>
          {t('fork.sleepers.sleepAllIdle', 'Sleep all idle')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => sleepRows(selectSleepExceptVisible(rows ?? []))}
        >
          {t('fork.sleepers.sleepExceptVisible', 'Sleep all except visible')}
        </Button>
      </div>
      <ForkSleepersFilters rows={rows ?? []} view={view} onChange={setView} />
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="mr-1 text-muted-foreground">
            {t('fork.sleepers.selected', '{{count}} selected', { count: selected.size })}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={count('sleep') === 0}
            onClick={() => bulk('sleep')}
          >
            {t('fork.sleepers.sleep', 'Sleep')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={count('pin') === 0}
            onClick={() => bulk('pin')}
          >
            {t('fork.sleepers.pin', 'Keep awake')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={count('unpin') === 0}
            onClick={() => bulk('unpin')}
          >
            {t('fork.sleepers.unpin', 'Let it sleep on idle')}
          </Button>
          <Button
            size="sm"
            variant={confirmBulkClose ? 'destructive' : 'ghost'}
            disabled={count('close') === 0}
            onBlur={() => setConfirmBulkClose(false)}
            onClick={() => {
              if (confirmBulkClose) {
                setConfirmBulkClose(false)
                bulk('close')
              } else {
                setConfirmBulkClose(true)
              }
            }}
          >
            {confirmBulkClose
              ? t('fork.sleepers.confirmCloseMany', 'Close {{count}} tabs?', {
                  count: count('close')
                })
              : t('fork.sleepers.close', 'Close')}
          </Button>
        </div>
      ) : null}
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !rows ? (
          <p className="text-sm text-muted-foreground">
            {t('fork.sleepers.loading', 'Loading...')}
          </p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('fork.sleepers.empty', 'No chats or terminal agents match.')}
          </p>
        ) : (
          shown.map((row) => (
            <ForkSleepersRow
              key={row.id}
              row={row}
              now={now}
              actions={actions}
              selected={selected.has(row.id)}
              onSelect={select}
            />
          ))
        )}
      </div>
    </div>
  )
}

export function ForkSleepersDialogHost(): React.JSX.Element | null {
  const t = useTranslate()
  const isOpen = useSyncExternalStore(subscribe, () => open)
  if (!isOpen) {
    return null
  }
  return (
    <Dialog open onOpenChange={(next) => setOpen(next)}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('fork.sleepers.title', 'Sleepers')}</DialogTitle>
          <DialogDescription>
            {t(
              'fork.sleepers.description',
              'Every chat and terminal agent. A sleeping chat keeps its tab and history and starts again on your next message. Sleep never stops a chat that is working, waiting on you, or running subagents.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Body />
      </DialogContent>
    </Dialog>
  )
}
