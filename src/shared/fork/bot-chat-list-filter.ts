// What chat list a client gets (FORK.md "Auto-close finished bot chats"): `bots.chatTree` leaves out
// closed chats, newest activity first, because the phone app is upstream's own build and shows
// whatever the host serves. Closed chats come back a page at a time through `fork.botChat.older`.
import * as z from 'zod'
import { orderBotChats, type BotChatTreeChat, type BotChatTreeRead } from '../bots/bot-chat-tree'

export const FORK_BOT_CHAT_OLDER_DEFAULT_LIMIT = 20
export const FORK_BOT_CHAT_OLDER_MAX_LIMIT = 100
export const FORK_BOT_CHAT_OLDER_METHOD = 'fork.botChat.older'

export const ForkBotChatOlderParams = z.object({
  botId: z.string().min(1),
  /** The last closed chat shown: only chats with an older last activity come back. */
  before: z.number().optional(),
  limit: z.number().int().positive().max(FORK_BOT_CHAT_OLDER_MAX_LIMIT).optional()
})
export type ForkBotChatOlderParams = z.infer<typeof ForkBotChatOlderParams>

export type ForkBotChatOlderResult = {
  chats: BotChatTreeChat[]
  /** Closed chats older than the last one returned. */
  more: boolean
  total: number
}

/** The tree as a client lists it: open chats only, with how many closed ones were left out. */
export function forkOpenBotChatTree(tree: BotChatTreeRead): BotChatTreeRead {
  const open = orderBotChats(tree.chats.filter((chat) => !chat.closed))
  const closedTotal = tree.chats.length - open.length
  return {
    ...tree,
    chats: open,
    ...(closedTotal > 0 ? { closedTotal } : {})
  }
}

/** One page of closed chats, newest last activity first. */
export function forkOlderBotChats(
  tree: Pick<BotChatTreeRead, 'chats'>,
  params: Pick<ForkBotChatOlderParams, 'before' | 'limit'>
): ForkBotChatOlderResult {
  const closed = tree.chats
    .filter((chat) => chat.closed)
    .toSorted((a, b) => b.lastActiveAt - a.lastActiveAt)
  const { before } = params
  const after = before === undefined ? closed : closed.filter((chat) => chat.lastActiveAt < before)
  const limit = params.limit ?? FORK_BOT_CHAT_OLDER_DEFAULT_LIMIT
  return { chats: after.slice(0, limit), more: after.length > limit, total: closed.length }
}
