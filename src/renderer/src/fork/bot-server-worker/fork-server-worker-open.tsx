// BAD-642 (FORK.md "Bot items: workers on a paired server"): a bot item's server worker opens on
// its server, and says where it runs and when it was last active.
import { useTranslate } from '@/i18n/use-translate'
import { useNow } from '@/lib/window-activity/use-now'
import { openOrchestrationWorker } from '@/lib/open-orchestration-worker'
import { useBotHostLabel } from '@/components/bots/use-bot-host-label'
import type { BotOnHost } from '@/lib/bot-hosts'
import type { BotChatTreeWorker } from '../../../../shared/bots/bot-chat-tree'
import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId
} from '../../../../shared/execution-host/execution-host'
import { forkServerWorkerAgo } from '../../../../shared/fork/bot-server-worker'

/**
 * Opens a worker a paired server runs as its own: the server looks up its Dispatch and the window
 * shows that server's workspace on the worker's pane, the way the sidebar opens a server workspace.
 * Undefined for any other worker, and for a bot on a server (whose server ids are not this desktop's).
 */
export function forkServerWorkerOpen(
  bot: BotOnHost,
  worker: BotChatTreeWorker
): (() => void) | undefined {
  const server = worker.forkServer
  if (!server || !worker.dispatchId || bot.hostId !== LOCAL_EXECUTION_HOST_ID) {
    return undefined
  }
  const { dispatchId, title } = worker
  return () =>
    openOrchestrationWorker(
      { dispatchId, title, worktreeId: null, chatSessionId: null },
      { kind: 'environment', environmentId: server.environmentId }
    )
}

const STATE_WORDS: Record<BotChatTreeWorker['state'], [key: string, fallback: string]> = {
  running: ['fork.botServerWorker.working', 'Working'],
  'needs-you': ['fork.botServerWorker.needsYou', 'Needs you'],
  'asking-bot': ['fork.botServerWorker.asking', 'Asking'],
  unreachable: ['fork.botServerWorker.unknown', 'Status unknown'],
  done: ['fork.botServerWorker.done', 'Done'],
  failed: ['fork.botServerWorker.failed', 'Failed']
}

/** "Working on m2mac-server · 13 s ago": a server worker's state, server and last activity; `compact`
 *  leaves the state to the icon beside it ("m2mac-server · 13 s ago"). Null for any other worker. */
export function ForkServerWorkerNote({
  worker,
  compact = false,
  className
}: {
  worker: BotChatTreeWorker
  compact?: boolean
  className?: string
}): React.JSX.Element | null {
  const t = useTranslate()
  const server = worker.forkServer
  const host = useBotHostLabel(
    server ? toRuntimeExecutionHostId(server.environmentId) : LOCAL_EXECUTION_HOST_ID
  )
  const now = useNow(1_000, server?.seenAt !== undefined)
  if (!server) {
    return null
  }
  const [key, fallback] = STATE_WORDS[worker.state]
  const state = t(key, fallback)
  const parts = compact
    ? host
      ? [host]
      : []
    : [host ? t('fork.botServerWorker.stateOn', '{{state}} on {{host}}', { state, host }) : state]
  if (server.seenAt !== undefined) {
    const ago = forkServerWorkerAgo(server.seenAt, now)
    parts.push(
      t(`fork.botServerWorker.ago.${ago.unit}`, `{{count}} ${ago.unit} ago`, { count: ago.count })
    )
  }
  return parts.length > 0 ? <span className={className}>{parts.join(' · ')}</span> : null
}
