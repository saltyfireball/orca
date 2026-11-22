// Mail for a chat Orca auto-closed reopens it first (FORK.md, BAD-734), so the send is delivered and
// never refused as "ended". Called before a session-shaped recipient is routed. A chat the owner
// closed by hand is not in the registry and stays closed.
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { readAgentSessionRecordStore } from '../../runtime/orchestration/addressing/session-lineage/structured-session-lineage'
import { isOrcaSessionId } from '../../../shared/agent-session/identity/orca-session-address'
import { createCanonicalOrcaSessionResolver } from '../../runtime/orchestration/addressing/session-lineage/canonical-orca-session-id'
import {
  autoClosedChatKey,
  forgetAutoClosedChat,
  isAutoClosedChat
} from './bot-chat-auto-closed-registry'

export type BotChatReopenDeps = {
  rootOf: (id: string) => string
  isAutoClosed: (chatId: string) => Promise<boolean>
  show: (chatId: string) => Promise<void>
  forget: (chatId: string) => Promise<void>
}

export async function reopenAutoClosedBotChat(
  deps: BotChatReopenDeps,
  recipient: string
): Promise<boolean> {
  const chatId = deps.rootOf(autoClosedChatKey(recipient))
  if (!(await deps.isAutoClosed(chatId))) {
    return false
  }
  try {
    await deps.show(chatId)
    await deps.forget(chatId)
    return true
  } catch (error) {
    // The send then fails as it would have; the chat stays listed for the next try.
    console.warn('[fork bot chat auto-close] could not reopen a chat that got mail', error)
    return false
  }
}

/** Hook (session-recipient.ts, bots-chats.ts): reopens the chat `recipient` names when Orca closed it. */
export async function forkReopenAutoClosedChat(recipient: string): Promise<boolean> {
  const host = getStructuredAgentSessionHost()
  if (!host) {
    return false
  }
  const store = readAgentSessionRecordStore()
  const root = store ? createCanonicalOrcaSessionResolver(store) : (id: string) => id
  return reopenAutoClosedBotChat(
    {
      rootOf: (id) => (isOrcaSessionId(id) ? root(id) : id),
      isAutoClosed: isAutoClosedChat,
      show: (chatId) => host.setSessionTabVisibility(chatId, true),
      forget: forgetAutoClosedChat
    },
    recipient
  )
}
