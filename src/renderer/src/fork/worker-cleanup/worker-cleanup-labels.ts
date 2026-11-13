// Worker cleanup (FORK.md): the notice text for one sweep.
import { translate } from '@/i18n/i18n'
import type { ForkWorkerCleanupItem } from '../../../../shared/fork/worker-cleanup'

export function noticeText(items: readonly ForkWorkerCleanupItem[]): string {
  const released = items.filter((item) => item.kind === 'chat-released').length
  const closed = items.length - released
  const parts: string[] = []
  if (closed > 0) {
    parts.push(
      closed === 1
        ? translate('fork.workerCleanup.closedOne', '1 finished worker closed.')
        : translate('fork.workerCleanup.closedMany', '{{count}} finished workers closed.', {
            count: closed
          })
    )
  }
  if (released > 0) {
    parts.push(
      released === 1
        ? translate('fork.workerCleanup.releasedOne', '1 finished worker stopped.')
        : translate('fork.workerCleanup.releasedMany', '{{count}} finished workers stopped.', {
            count: released
          })
    )
  }
  return parts.join(' ')
}
