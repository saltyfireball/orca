// SLRM-2098 (FORK.md "Agent launch queue"): shown in a chat whose start waits for a free agent
// slot. Messages sent meanwhile stay in the chat's queue and go out when it starts.
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useForkQueuedLaunch } from './use-fork-agent-queue'

export function ForkAgentQueueBanner({
  sessionId
}: {
  sessionId: string
}): React.JSX.Element | null {
  const entry = useForkQueuedLaunch(sessionId)
  if (!entry) {
    return null
  }
  const bridge = window.api.forkAgentQueue
  return (
    <div
      role="status"
      className="mx-3 mb-2 flex items-center gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {translate('fork.agentQueue.banner.title', 'Queued (position {{position}})', {
            position: entry.position
          })}
        </div>
        <div className="text-xs text-muted-foreground">
          {translate(
            'fork.agentQueue.banner.detail',
            'The agent limit is reached. This chat starts when another agent stops; messages you send now wait and go out then.'
          )}
        </div>
      </div>
      <Button size="sm" variant="default" onClick={() => void bridge?.start(entry.id)}>
        {translate('fork.agentQueue.startNow', 'Start now')}
      </Button>
      <Button size="sm" variant="outline" onClick={() => void bridge?.cancel(entry.id)}>
        {translate('fork.agentQueue.cancel', 'Cancel')}
      </Button>
    </div>
  )
}

/** The tab's "queued" badge, after its title. */
export function ForkAgentQueueTabBadge({
  sessionId
}: {
  sessionId: string | undefined
}): React.JSX.Element | null {
  const entry = useForkQueuedLaunch(sessionId)
  if (!entry) {
    return null
  }
  return (
    <span
      className="mr-1 shrink-0 rounded bg-muted px-1 text-[10px] leading-4 text-muted-foreground"
      title={translate('fork.agentQueue.badge.title', 'Waiting for a free agent slot')}
    >
      {translate('fork.agentQueue.badge.label', 'queued {{position}}', {
        position: entry.position
      })}
    </span>
  )
}
