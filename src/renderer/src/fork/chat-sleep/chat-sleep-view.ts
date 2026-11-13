// Chat sleep (FORK.md): what the renderer knows. Main decides when a chat sleeps; the renderer
// only reports which chats are on screen and shows a sleeping chat.
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import type { AgentStatusState } from '../../../../shared/agent-status/contracts/agent-status-types'
import { structuredAgentSessionPaneKey } from '../../../../shared/agent-session/view/structured-agent-session-projection'

export type OnScreenChatsInput = {
  activeWorktreeId: string | null
  groupsByWorktree: Record<string, readonly TabGroup[] | undefined> | undefined
  unifiedTabsByWorktree: Record<string, readonly Tab[] | undefined> | undefined
}

/**
 * The session ids of the native chats shown in the open workspace: the active tab of each of its
 * tab groups, when that tab is a chat. Every group counts, split or not, so a chat that might be
 * on screen stays awake. Sorted, so equal sets compare equal as strings.
 */
export function onScreenChatSessionIds({
  activeWorktreeId,
  groupsByWorktree,
  unifiedTabsByWorktree
}: OnScreenChatsInput): string[] {
  if (!activeWorktreeId) {
    return []
  }
  const tabs = unifiedTabsByWorktree?.[activeWorktreeId] ?? []
  const ids = new Set<string>()
  for (const group of groupsByWorktree?.[activeWorktreeId] ?? []) {
    const tab = group.activeTabId ? tabs.find((t) => t.id === group.activeTabId) : undefined
    if (tab?.contentType === 'agent-session' && tab.entityId) {
      ids.add(tab.entityId)
    }
  }
  return [...ids].sort()
}

/** The pane key of a native chat tab in this worktree, found by its session id; null if none. */
export function chatPaneKeyForSession(
  tabs: readonly Tab[] | undefined,
  sessionId: string
): string | null {
  const tab = (tabs ?? []).find(
    (t) => t.contentType === 'agent-session' && t.entityId === sessionId
  )
  return tab ? structuredAgentSessionPaneKey(tab.id, tab.entityId) : null
}

/** True when a native chat tab in this worktree has this pane key (a terminal agent never does). */
export function isChatPaneKey(tabs: readonly Tab[] | undefined, paneKey: string): boolean {
  return (tabs ?? []).some(
    (t) =>
      t.contentType === 'agent-session' &&
      // Cheap prefix check first, so only the row's own tab is hashed.
      paneKey.startsWith(`${t.id}:`) &&
      structuredAgentSessionPaneKey(t.id, t.entityId) === paneKey
  )
}

export type ChatSleepStatus = { state: AgentStatusState; structuredHostOwned?: true }

/**
 * A chat sleeps when it is settled (done) and no host runs its provider. Working, blocked and
 * waiting chats are never shown asleep, and neither is a chat with no status yet.
 */
export function isSleepingChatStatus(entry: ChatSleepStatus | undefined): boolean {
  return entry !== undefined && entry.state === 'done' && entry.structuredHostOwned !== true
}
