// Bot chats listed without an open tab (FORK.md "Bot chats listed without a tab"). Upstream lists only
// the chats of a bot whose tab is open on its host, so a chat another bot or a handoff started in a new
// chat (nobody opened it) was never listed under its bot. This lists such a chat while it is going, is
// new to the owner, or was active within a window. Pure: the rule and its setting.
import type { BotChatTreeChat } from '../bots/bot-chat-tree'

export type ForkBotChatListingSettings = {
  /** Fork (BAD-658): minutes a bot's chat with no open tab stays listed under it after its last activity (a running or new one always lists); unset is 60, 0 lists only chats with an open tab. */
  forkBotChatRecentMinutes?: number
  /** Fork (BAD-669): chats the owner hid from the sidebar, by chat id and when; one that needs the owner again lists again. */
  forkBotHiddenChats?: Record<string, number>
}

export const FORK_BOT_CHAT_RECENT_DEFAULT_MINUTES = 60

export type ForkBotChatRecent = {
  now: number
  windowMs: number
  /** Chats the owner hid (BAD-669); they never list. */
  hidden?: ReadonlySet<string>
}

/** The window as the listing rule takes it; null when the setting turns the rule off. */
export function forkBotChatRecent(
  settings: ForkBotChatListingSettings | null | undefined,
  now: number,
  hidden?: ReadonlySet<string>
): ForkBotChatRecent | null {
  const minutes = settings?.forkBotChatRecentMinutes
  const windowMs =
    typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0
      ? minutes * 60_000
      : FORK_BOT_CHAT_RECENT_DEFAULT_MINUTES * 60_000
  const hiddenSet = hidden && hidden.size > 0 ? hidden : undefined
  // A rule that lists nothing extra still has to carry the hidden chats.
  return windowMs > 0 || hiddenSet
    ? { now, windowMs, ...(hiddenSet ? { hidden: hiddenSet } : {}) }
    : null
}

/** A chat with no tab that still lists: a side chat or thread (never Home) that has not ended and is
 *  going, new to the owner, or recently active. */
export function forkListsTablessBotChat(chat: BotChatTreeChat, recent: ForkBotChatRecent): boolean {
  return (
    recent.windowMs > 0 &&
    chat.tab === false &&
    chat.origin !== 'home' &&
    !chat.closed &&
    (chat.live !== 'idle' ||
      chat.runningTotal > 0 ||
      chat.unseen === true ||
      recent.now - chat.lastActiveAt <= recent.windowMs)
  )
}
