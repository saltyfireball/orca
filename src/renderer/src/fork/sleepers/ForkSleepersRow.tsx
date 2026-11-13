// Sleepers (FORK.md): one row of the dialog with its own actions. Close asks once more in place.
import React, { useState } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { canSleepNow, type SleeperRow, type SleeperState } from '../../../../shared/fork/sleepers'
import { formatSleeperBytes } from './sleepers-view-model'
import {
  ForkSleepersLifecycleActions,
  sleeperLifecycleDetail
} from './ForkSleepersLifecycleActions'

export function sleeperStateLabel(state: SleeperState, t: Translate = translate): string {
  switch (state) {
    case 'working':
      return t('fork.sleepers.state.working', 'Working')
    case 'stalled':
      return t('fork.sleepers.state.stalled', 'Stalled')
    case 'needs-input':
      return t('fork.sleepers.state.needsInput', 'Needs input')
    case 'queued':
      return t('fork.sleepers.state.queued', 'Queued')
    case 'awake-idle':
      return t('fork.sleepers.state.awakeIdle', 'Awake, idle')
    case 'asleep':
      return t('fork.sleepers.state.asleep', 'Asleep')
  }
}

export function sleeperAge(ms: number | null, t: Translate = translate): string {
  if (ms === null) {
    return '-'
  }
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return t('fork.sleepers.age.now', 'now')
  }
  if (minutes < 60) {
    return t('fork.sleepers.age.minutes', '{{count}}m', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  return hours < 48
    ? t('fork.sleepers.age.hours', '{{count}}h', { count: hours })
    : t('fork.sleepers.age.days', '{{count}}d', { count: Math.floor(hours / 24) })
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
  const t = useTranslate()
  const [confirmClose, setConfirmClose] = useState(false)
  const memory = formatSleeperBytes(row.memoryBytes)
  const details = [
    row.kind === 'chat'
      ? t('fork.sleepers.kind.chat', 'Chat')
      : t('fork.sleepers.kind.terminal', 'Terminal'),
    sleeperLifecycleDetail(row, now, t),
    row.workspace,
    row.model ?? row.agent ?? '',
    memory,
    row.onScreen ? t('fork.sleepers.onScreen', 'on screen') : '',
    row.local ? '' : t('fork.sleepers.remote', 'other host')
  ].filter(Boolean)
  return (
    <div className="flex items-center gap-3 border-b border-border/50 py-2 text-sm last:border-b-0">
      <input
        type="checkbox"
        className="shrink-0"
        aria-label={t('fork.sleepers.select', 'Select {{title}}', { title: row.title })}
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
      <div className="w-24 shrink-0 text-xs">{sleeperStateLabel(row.state, t)}</div>
      <div
        className="w-20 shrink-0 text-right text-xs text-muted-foreground"
        title={t('fork.sleepers.lastActivity', 'Last activity {{age}} ago', {
          age: sleeperAge(now - row.lastActivityAt, t)
        })}
      >
        {sleeperAge(row.idleMs, t)}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        <ForkSleepersLifecycleActions row={row} after={actions.after} />
        {canSleepNow(row) ? (
          <Button size="sm" variant="ghost" onClick={() => actions.sleep(row)}>
            {t('fork.sleepers.sleep', 'Sleep')}
          </Button>
        ) : null}
        {row.worktreeId ? (
          <Button size="sm" variant="ghost" onClick={() => actions.wake(row)}>
            {row.state === 'asleep'
              ? t('fork.sleepers.wake', 'Wake')
              : t('fork.sleepers.open', 'Open')}
          </Button>
        ) : null}
        {row.kind === 'chat' && row.local ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={
              row.pinned
                ? t('fork.sleepers.unpin', 'Let it sleep on idle')
                : t('fork.sleepers.pin', 'Keep awake')
            }
            title={
              row.pinned
                ? t('fork.sleepers.unpin', 'Let it sleep on idle')
                : t('fork.sleepers.pin', 'Keep awake')
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
            {t('fork.sleepers.confirmClose', 'Close tab?')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmClose(true)}>
            {t('fork.sleepers.close', 'Close')}
          </Button>
        )}
      </div>
    </div>
  )
}
