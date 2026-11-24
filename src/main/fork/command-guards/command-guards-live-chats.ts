// Command guards (FORK.md, BAD-764): the Claude chats whose provider runs on this host now, so the
// status counts live chats only and one the guard registry does not know still shows. Keep electron
// out of this file.
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { resolveStructuredWorkerIdentityForSession } from '../../runtime/orchestration/terminal-authority/structured-sessions/structured-worker-authority'
import type { GuardedChatSurface } from './command-guards-chat-registry'

export function commandGuardChatSurface(sessionId: string): GuardedChatSurface {
  try {
    return resolveStructuredWorkerIdentityForSession(sessionId, null)
      ? 'chat-worker'
      : 'native-chat'
  } catch {
    return 'native-chat'
  }
}

/** Surface by session id. */
export function liveCommandGuardChats(): Map<string, GuardedChatSurface> {
  const host = getStructuredAgentSessionHost()
  const live = new Map<string, GuardedChatSurface>()
  for (const sessionId of host?.loadedSessionIds() ?? []) {
    if (host?.deps.store.getRecord(sessionId)?.provider === 'claude') {
      live.set(sessionId, commandGuardChatSurface(sessionId))
    }
  }
  return live
}
