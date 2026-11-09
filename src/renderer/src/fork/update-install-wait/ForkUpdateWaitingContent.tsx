import { Minus } from 'lucide-react'
import type { UpdateStatus } from '../../../../shared/update-status-types'
import type { ForkUpdateInstallWait } from '../../../../shared/fork/update-install-wait'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

function waitingTitle(remaining: number): string {
  return remaining === 1
    ? translate('fork.restartGuard.card.waitingOne', 'Waiting for 1 chat')
    : translate('fork.restartGuard.card.waitingMany', 'Waiting for {{count}} chats', {
        count: remaining
      })
}

/** The update card while the restart guard holds the install for busy chats (SLRM-1569). */
export function ForkUpdateWaitingContent({
  wait,
  onCollapse
}: {
  wait: ForkUpdateInstallWait
  onCollapse: () => void
}): React.JSX.Element {
  const bridge = window.api.forkUpdateInstallWait
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{waitingTitle(wait.remaining)}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 min-w-[44px] min-h-[44px] -m-2"
          onClick={onCollapse}
          aria-label={translate('fork.restartGuard.card.minimize', 'Minimize to status bar')}
        >
          <Minus className="size-3.5" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {translate(
          'fork.restartGuard.card.waitingSummary',
          '{{done}} of {{total}} chats finished. The update installs once they are idle.',
          { done: wait.total - wait.remaining, total: wait.total }
        )}
      </p>
      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          className="flex-1"
          onClick={() => void bridge?.installNow()}
        >
          {translate('fork.restartGuard.restartNow', 'Restart Now')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => void bridge?.stopWaiting()}
        >
          {translate('fork.restartGuard.stopWaiting', 'Stop Waiting')}
        </Button>
      </div>
    </div>
  )
}

/** The waiting view in place of the card's downloaded content, or null to render it as usual. */
export function forkUpdateWaitingCard(
  status: UpdateStatus,
  wait: ForkUpdateInstallWait | null,
  onCollapse: () => void
): React.JSX.Element | null {
  if (!wait || status.state !== 'downloaded' || status.installing) {
    return null
  }
  return <ForkUpdateWaitingContent wait={wait} onCollapse={onCollapse} />
}
