// Sleepers (FORK.md): one row of the dialog with its own actions. Close asks once more in place.
import React, { useState } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { canSleepNow, type SleeperRow, type SleeperState } from '../../../../shared/fork/sleepers'
import { formatSleeperBytes } from './sleepers-view-model'
import {
  ForkSleepersLifecycleActions,
  sleeperLifecycleDetail
} from './ForkSleepersLifecycleActions'

export function sleeperStateLabel(state: SleeperState): string {
  switch (state) {
    case 'working':
      return translate('fork.sleepers.state.working', 'Working')
    case 'stalled':
      return translate('fork.sleepers.state.stalled', 'Stalled')
    case 'needs-input':
      return translate('fork.sleepers.state.needsInput', 'Needs input')
    case 'queued':
      return translate('fork.sleepers.state.queued', 'Queued')
    case 'awake-idle':
      return translate('fork.sleepers.state.awakeIdle', 'Awake, idle')
    case 'asleep':
      return translate('fork.sleepers.state.asleep', 'Asleep')
  }
}

export function sleeperAge(ms: number | null): string {
  if (ms === null) {
    return '-'
  }
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return translate('fork.sleepers.age.now', 'now')
  }
  if (minutes < 60) {
    return translate('fork.sleepers.age.minutes', '{{count}}m', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  return hours < 48
    ? translate('fork.sleepers.age.hours', '{{count}}h', { count: hours })
    : translate('fork.sleepers.age.days', '{{count}}d', { count: Math.floor(hours / 24) })
}

export type SleeperRowActions = {
  sleep: (row: SleeperRow) => void
  wake: (row: SleeperRow) => void
  pin: (row: SleeperRow, pinned: boolean) => void
  close: (row: SleeperRow) => void
  /** A stall or queue action ran; refresh once it lands. */
  after: (work: Promise<unknown>) => void
}

export function ForkSleepersRow({
  row,
  now,
  actions,
  selected,
  onSelect
}: {
  row: SleeperRow
  now: number
  actions: SleeperRowActions
  selected: boolean
  onSelect: (id: string, selected: boolean) => void
}): React.JSX.Element {
  const [confirmClose, setConfirmClose] = useState(false)
  const memory = formatSleeperBytes(row.memoryBytes)
  const details = [
    row.kind === 'chat'
      ? translate('fork.sleepers.kind.chat', 'Chat')
      : translate('fork.sleepers.kind.terminal', 'Terminal'),
    sleeperLifecycleDetail(row, now),
    row.workspace,
    row.model ?? row.agent ?? '',
    memory,
    row.onScreen ? translate('fork.sleepers.onScreen', 'on screen') : '',
    row.local ? '' : translate('fork.sleepers.remote', 'other host')
  ].filter(Boolean)
  return (
    <div className="flex items-center gap-3 border-b border-border/50 py-2 text-sm last:border-b-0">
      <input
        type="checkbox"
        className="shrink-0"
        aria-label={translate('fork.sleepers.select', 'Select {{title}}', { title: row.title })}
        checked={selected}
        onChange={(event) => onSelect(row.id, event.target.checked)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {row.pinned ? <Pin className="size-3 shrink-0 text-muted-foreground" /> : null}
          <span className="truncate font-medium">{row.title}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{details.join(' - ')}</div>
      </div>
      <div className="w-24 shrink-0 text-xs">{sleeperStateLabel(row.state)}</div>
      <div
        className="w-20 shrink-0 text-right text-xs text-muted-foreground"
        title={translate('fork.sleepers.lastActivity', 'Last activity {{age}} ago', {
          age: sleeperAge(now - row.lastActivityAt)
        })}
      >
        {sleeperAge(row.idleMs)}
      </div>
      <div className="flex w-80 shrink-0 justify-end gap-1">
        <ForkSleepersLifecycleActions row={row} after={actions.after} />
        {canSleepNow(row) ? (
          <Button size="sm" variant="ghost" onClick={() => actions.sleep(row)}>
            {translate('fork.sleepers.sleep', 'Sleep')}
          </Button>
        ) : null}
        {row.worktreeId ? (
          <Button size="sm" variant="ghost" onClick={() => actions.wake(row)}>
            {row.state === 'asleep'
              ? translate('fork.sleepers.wake', 'Wake')
              : translate('fork.sleepers.open', 'Open')}
          </Button>
        ) : null}
        {row.kind === 'chat' && row.local ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={
              row.pinned
                ? translate('fork.sleepers.unpin', 'Let it sleep on idle')
                : translate('fork.sleepers.pin', 'Keep awake')
            }
            title={
              row.pinned
                ? translate('fork.sleepers.unpin', 'Let it sleep on idle')
                : translate('fork.sleepers.pin', 'Keep awake')
            }
            onClick={() => actions.pin(row, !row.pinned)}
          >
            {row.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </Button>
        ) : null}
        {!row.worktreeId ? null : confirmClose ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setConfirmClose(false)
              actions.close(row)
            }}
            onBlur={() => setConfirmClose(false)}
          >
            {translate('fork.sleepers.confirmClose', 'Close tab?')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmClose(true)}>
            {translate('fork.sleepers.close', 'Close')}
          </Button>
        )}
      </div>
    </div>
  )
}
