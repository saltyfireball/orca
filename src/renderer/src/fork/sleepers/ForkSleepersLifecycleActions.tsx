// Sleepers (SLRM-2136): a stalled row's stall menu (Interrupt, Release, Wake when stopped) and a
// queued row's Start now and Cancel. Both are those features' own actions, not copies.
import React from 'react'
import { Hourglass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { SleeperRow } from '../../../../shared/fork/sleepers'
import { ForkChatStallMenu } from '../chat-stall/ForkChatStall'
import { actOnQueuedSleeper } from './sleepers-actions'

export function ForkSleepersLifecycleActions({
  row,
  after
}: {
  row: SleeperRow
  /** Refresh the list once an action lands. */
  after: (work: Promise<unknown>) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  if (row.queue && row.local) {
    return (
      <>
        <Button size="sm" variant="ghost" onClick={() => after(actOnQueuedSleeper(row, 'start'))}>
          {t('fork.sleepers.startNow', 'Start now')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => after(actOnQueuedSleeper(row, 'cancel'))}>
          {t('fork.sleepers.cancelQueued', 'Cancel')}
        </Button>
      </>
    )
  }
  if (row.stall && row.local) {
    return (
      <ForkChatStallMenu
        entry={{ sessionId: row.id, ...row.stall }}
        trigger={
          <Button size="sm" variant="ghost" data-fork-chat-stalled="">
            <Hourglass className="size-3.5 text-status-warning" aria-hidden />
            {t('fork.sleepers.stallActions', 'Stall actions')}
          </Button>
        }
      />
    )
  }
  return null
}

/** The extra line a queued or stalled row shows under its title: why it waits or how long. */
export function sleeperLifecycleDetail(
  row: SleeperRow,
  now: number,
  t: Translate = translate
): string {
  if (row.queue) {
    const position = row.queue.position
    return row.queue.heldReason
      ? t('fork.sleepers.queuedHeld', 'Queued #{{position}}: {{reason}}', {
          position,
          reason: row.queue.heldReason
        })
      : t('fork.sleepers.queuedLimit', 'Queued #{{position}}: agent limit reached', {
          position
        })
  }
  if (row.stall) {
    const count = Math.max(0, Math.floor((now - row.stall.quietSince) / 60_000))
    return t('fork.sleepers.stalledFor', 'No output for {{count}} min', { count })
  }
  return ''
}
