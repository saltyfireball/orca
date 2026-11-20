// Close a bot's chat (FORK.md, BAD-669): ends a side chat the way an ended session is closed, so it
// drops out of the sidebar and its history stays in the bot's Chats tab. Never the Home Chat and
// never a run listed as a chat. The host reads the chat itself, so a client cannot name another
// bot's session or a chat that is not the bot's.
import type {
  ForkBotChatCloseParams,
  ForkBotChatCloseResult
} from '../../../shared/fork/bot-chat-hide'
import { forkBotChatCanDismiss } from '../../../shared/fork/bot-chat-hide'
import type { BotChatTreeChat } from '../../../shared/bots/bot-chat-tree'

export type BotChatCloseDeps = {
  /** The bot's chats on this host, as `bots.chatTree` reads them. */
  readChats: (botId: string) => Promise<readonly BotChatTreeChat[] | null>
  /** Stops the chat's agent and closes its tab; `stopped` false when it could not. */
  closeSession: (sessionId: string) => Promise<{ stopped: boolean; reason?: string }>
}

export async function closeForkBotChat(
  deps: BotChatCloseDeps,
  params: ForkBotChatCloseParams
): Promise<ForkBotChatCloseResult> {
  const chats = await deps.readChats(params.botId)
  const chat = chats?.find((entry) => entry.chatId === params.chatId)
  if (!chat) {
    return { closed: false, reason: 'not-found' }
  }
  if (chat.origin === 'home') {
    return { closed: false, reason: 'home' }
  }
  if (!forkBotChatCanDismiss(chat)) {
    return chat.closed ? { closed: true } : { closed: false, reason: 'not-a-chat' }
  }
  const outcome = await deps.closeSession(chat.chatId)
  return outcome.stopped
    ? { closed: true }
    : { closed: false, reason: 'failed', ...(outcome.reason ? { detail: outcome.reason } : {}) }
}
