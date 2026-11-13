// Chat stall (FORK.md): what the renderer derives. Main decides which chats are stalled; the
// renderer finds a row's chat and words the mark.
import type { Tab } from '../../../../shared/tab-types'
import type { ForkChatStallEntry } from '../../../../shared/fork/chat-stall'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'

/** The session id of the native chat tab with this pane key; null for any other row. */
export function chatSessionIdForPaneKey(
  tabs: readonly Tab[] | undefined,
  paneKey: string
): string | null {
  const tab = (tabs ?? []).find(
    (t) =>
      t.contentType === 'agent-session' &&
      // Cheap prefix check first, so only the row's own tab is hashed.
      paneKey.startsWith(`${t.id}:`) &&
      structuredAgentSessionPaneKey(t.id, t.entityId) === paneKey
  )
  return tab?.entityId ?? null
}

/** Whole minutes since the chat last recorded provider output, never negative. */
export function chatStallQuietMinutes(entry: ForkChatStallEntry, now: number): number {
  return Math.max(0, Math.floor((now - entry.quietSince) / 60_000))
}

/** Wake only helps a provider that is in the stopped state. */
export function chatStallCanWake(entry: ForkChatStallEntry): boolean {
  return entry.liveness === 'stopped'
}
