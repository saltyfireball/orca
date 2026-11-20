// Hide a bot's chat from the sidebar (FORK.md, BAD-669). A hidden chat keeps running and stays in
// the bot's Chats tab; it lists again when it needs the owner after it was hidden (a question, a
// worker waiting on them, or a reply they have not read). Pure: the rule and the stored map.
import { z } from 'zod'
import type { BotChatTreeChat } from '../bots/bot-chat-tree'

/** Most hidden chats kept; the oldest are dropped past it. */
export const FORK_BOT_HIDDEN_CHATS_MAX = 500

export type ForkBotHiddenChats = Record<string, number>

/** The Home Chat is never hidden or closed from the sidebar, and neither is a run listed as a chat. */
export function forkBotChatCanDismiss(chat: BotChatTreeChat): boolean {
  return chat.origin !== 'home' && !chat.closed && chat.run === undefined
}

/** The chat needs the owner, and not already when they hid it. */
export function forkBotChatNeedsOwnerSince(chat: BotChatTreeChat, hiddenAt: number): boolean {
  return (
    chat.live === 'needs-you' ||
    chat.running.some((worker) => worker.state === 'needs-you') ||
    (chat.unread && chat.turnDone !== undefined && chat.turnDone.at > hiddenAt)
  )
}

export type ForkBotHiddenView = {
  /** Chats that stay out of the sidebar now. */
  hidden: Set<string>
  /** Chats hidden before that need the owner again: listed, and cleared from the stored map. */
  reappeared: string[]
}

export function forkBotChatHiddenIds(
  chats: readonly BotChatTreeChat[],
  stored: ForkBotHiddenChats | null | undefined
): ForkBotHiddenView {
  const hidden = new Set<string>()
  const reappeared: string[] = []
  if (!stored) {
    return { hidden, reappeared }
  }
  for (const chat of chats) {
    const hiddenAt = stored[chat.chatId]
    if (hiddenAt === undefined || !forkBotChatCanDismiss(chat)) {
      continue
    }
    if (forkBotChatNeedsOwnerSince(chat, hiddenAt)) {
      reappeared.push(chat.chatId)
    } else {
      hidden.add(chat.chatId)
    }
  }
  return { hidden, reappeared }
}

/** A chat with nothing going on: not replying, no worker running, nothing waiting on the owner. */
export function forkBotChatFinished(chat: BotChatTreeChat): boolean {
  return (
    chat.live === 'idle' &&
    chat.runningTotal === 0 &&
    chat.running.length === 0 &&
    !forkBotChatNeedsOwnerSince(chat, 0)
  )
}

/** The chats "Hide finished chats" hides: finished, hideable and not hidden already. */
export function forkBotFinishedChatIds(
  chats: readonly BotChatTreeChat[],
  alreadyHidden: ReadonlySet<string>
): string[] {
  return chats
    .filter(
      (chat) =>
        forkBotChatCanDismiss(chat) && !alreadyHidden.has(chat.chatId) && forkBotChatFinished(chat)
    )
    .map((chat) => chat.chatId)
}

export function forkBotHiddenChatsWith(
  stored: ForkBotHiddenChats | null | undefined,
  chatIds: readonly string[],
  now: number
): ForkBotHiddenChats {
  const next: ForkBotHiddenChats = { ...stored }
  for (const id of chatIds) {
    next[id] = now
  }
  const entries = Object.entries(next)
  if (entries.length <= FORK_BOT_HIDDEN_CHATS_MAX) {
    return next
  }
  entries.sort((a, b) => b[1] - a[1])
  return Object.fromEntries(entries.slice(0, FORK_BOT_HIDDEN_CHATS_MAX))
}

export function forkBotHiddenChatsWithout(
  stored: ForkBotHiddenChats | null | undefined,
  chatIds: readonly string[]
): ForkBotHiddenChats {
  const next: ForkBotHiddenChats = { ...stored }
  for (const id of chatIds) {
    delete next[id]
  }
  return next
}

/** `fork.botChat.close`: end one of a bot's chats the way an ended session is closed. */
export const ForkBotChatCloseParams = z.object({
  botId: z.string().min(1).max(256),
  chatId: z.string().min(1).max(256)
})
export type ForkBotChatCloseParams = z.infer<typeof ForkBotChatCloseParams>

export type ForkBotChatCloseResult =
  | { closed: true }
  | { closed: false; reason: 'not-found' | 'home' | 'not-a-chat' | 'failed'; detail?: string }
